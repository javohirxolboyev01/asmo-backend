import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import apiRouter from './apiRouter.js';
import { config } from './config.js';

const app = express();
app.use(helmet());
app.use(cors({ origin: config.corsOrigins }));
app.use(express.json({ limit: '3mb' }));
app.use(morgan('dev'));
app.use('/api', apiRouter);
app.use((_req, res) => res.status(404).json({ error: 'Route not found' }));
app.listen(config.port, () => console.log(`Asmo backend listening on http://localhost:${config.port}`));
