import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import routes from './routes.js';

const app = express();
const port = Number(process.env.PORT ?? 4000);
app.use(helmet());
app.use(cors({ origin: (process.env.CORS_ORIGIN ?? 'http://localhost:3000').split(',').map((x) => x.trim()) }));
app.use(express.json({ limit: '3mb' }));
app.use(morgan('dev'));
app.use('/api', routes);
app.use((_req, res) => res.status(404).json({ error: 'Route not found' }));
app.listen(port, () => console.log(`Asmo backend listening on http://localhost:${port}`));
