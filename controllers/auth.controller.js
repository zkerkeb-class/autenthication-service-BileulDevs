const axios = require('axios');
const logger = require("../config/logger");
const bcrypt = require("bcrypt");
const jwt = require('jsonwebtoken');
const generateToken = require('../helpers/generateToken');
require("dotenv").config();

const extractUser = (provider, profile) => {
  let email = profile.emails?.[0]?.value || `${profile.id}@${provider}.auth`;
  let username = profile.displayName || profile.username || 'Inconnu';

  return { email, username, provider };
};

const registerWithPassport = async (profile, provider, res) => {
    try {
        const user = extractUser(provider, profile);

        await axios.post(`${process.env.BDD_SERVICE_URL}/api/users`, user);

        const token = generateToken(user);

        await axios.post(`${process.env.NOTIFS_SERVICE_URL}/api/mailer/send-validation-email`, {
            to: user.email,
            validationUrl: `${process.env.AUTH_SERVICE_URL}/api/validate-email?token=${token}`
        });
        
        res.json({
            token: token
        });

    } catch (err) {
        console.error(`[${provider} Callback Error]:`, err.message);
        res.status(500).json({ error: `Erreur auth : ${err.message}` });
    }
};

exports.getMe = async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ message: 'Token d\'authentification non fourni' });
        }

        const token = authHeader.split(' ')[1];
        
        if (!token) {
            return res.status(401).json({ message: 'Token d\'authentification non valide' });
        }
        
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            
            const userId = decoded.id;
        
            const response = await axios.get(`${process.env.BDD_SERVICE_URL}/api/users/${userId}`);
            

            if (!response.data) {
                logger.warn(`User not found for ID: ${userId}`);
                return res.status(404).json({ message: 'Utilisateur non trouvé' });
            }
            
            const user = response.data;
            if (user.password) {
                delete user.password;
            }
            
            logger.info(`Successfully retrieved user information for ID: ${userId}`);
            return res.status(200).json({ user: user });
            
        } catch (tokenError) {
            logger.warn(`Invalid token: ${tokenError.message}`);
            return res.status(401).json({ message: 'Token invalide ou expiré' });
        }
        
    } catch (error) {
        logger.error(`Error retrieving user: ${error.message}`);
        return res.status(500).json({ message: 'Erreur lors de la récupération des informations utilisateur' });
    }
};

exports.registerUser = async (req, res) => {
    try {

        const { username, email, password, provider } = req.body;
        
        const response = await axios.post(`${process.env.BDD_SERVICE_URL}/api/users`, req.body);
        const user = response.data;
        const token = generateToken(user);

        await axios.post(`${process.env.NOTIFS_SERVICE_URL}/api/mailer/send-validation-email`, {
            to: email,
            validationUrl: `${process.env.AUTH_SERVICE_URL}/api/auth/validate-email?token=${token}`
        });

        logger.info(`Sent request to create user : ${email}`);
        res.status(201).json({
            token: token,
            user: response.data
        });

    } catch (error) {
        logger.error(`Error creating user: ${error.message}`);
        res.status(400).json({ message: error.message });
    }
};

exports.loginUser = async (req, res) => {
    try {
        const { email, password } = req.body;
        const provider = req.body.provider || 'local';

        const checkUser = await axios.post(`${process.env.BDD_SERVICE_URL}/api/auth/checkUser`, {email: email})
        const user = checkUser.data;

        if (!user) {
            return res.status(404).json({ message: 'Utilisateur non trouvé' });
        }
        if (user.provider !== provider) {
            return res.status(400).json({ message: `Ce compte est lié à ${user.provider}, pas à ${provider}` });
        }
        if (provider === 'local') {
            const isMatch = await bcrypt.compare(password, user.password);
            if (!isMatch) {
                return res.status(401).json({ message: 'Mot de passe invalide' });
            }
        }

        const token = generateToken(user);
        res.status(200).json({ user: user, token : token });

    } catch (error) {
        logger.error(`Erreur de connexion: ${error.message}`);
        res.status(error.response?.status || 500).json({ message: error.response.data.message });
    }
};

exports.validateEmail = async (req, res) => {
    const { token } = req.query;
    try {
        const payload = jwt.verify(token, process.env.JWT_SECRET);
        await axios.post(`${process.env.BDD_SERVICE_URL}/api/users/${payload.id}/verify-email`);

        logger.info(`Email vérifié avec succès: ${payload.id}`);
        res.status(200).send('Email vérifié avec succès.');
    } catch (err) {
        logger.error(`Erreur: ${err.message}`);
        res.status(400).send(`Lien de validation invalide ou expiré : ${err.message}`);
    }

};

exports.google = (req, res) => {
    registerWithPassport(req.user, 'google', res);
};
exports.facebook = (req, res) => {
    registerWithPassport(req.user, 'facebook', res);
};
exports.twitter = (req, res) => {
    registerWithPassport(req.user, 'twitter', res);
};