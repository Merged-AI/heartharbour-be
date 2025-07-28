# HeartHarbour Express Backend

A standalone Express.js backend API for HeartHarbour, migrated from Next.js API routes to support both web and mobile applications.

## Features

- 🚀 **Express.js** with TypeScript
- 🔐 **Authentication** with Supabase
- 🛡️ **Security** with Helmet, CORS, and rate limiting
- 📊 **Health monitoring** endpoints
- 🔄 **CORS support** for web and mobile apps
- 📝 **Structured logging** with Morgan
- ⚡ **Production-ready** with error handling

## Project Structure

```
backend/
├── src/
│   ├── index.ts              # Main server entry point
│   ├── lib/
│   │   ├── auth.ts           # Authentication utilities
│   │   └── supabase.ts       # Supabase client configuration
│   ├── middleware/
│   │   ├── errorHandler.ts   # Global error handling
│   │   └── notFoundHandler.ts # 404 handler
│   └── routes/
│       ├── auth.ts           # Authentication routes
│       └── health.ts         # Health check routes
├── package.json
├── tsconfig.json
├── env.example
└── README.md
```

## Quick Start

### 1. Install Dependencies

```bash
cd backend
npm install
```

### 2. Environment Setup

Copy the environment example file and configure your variables:

```bash
cp env.example .env
```

Update `.env` with your actual values:
- Supabase credentials
- Stripe keys
- OpenAI API key
- Pinecone configuration

### 3. Development

```bash
npm run dev
```

The server will start on `http://localhost:3001`

### 4. Production Build

```bash
npm run build
npm start
```

## API Endpoints

### Health Check
- `GET /health` - Basic health check
- `GET /api/health` - Detailed health status with environment checks

### Authentication
- `GET /api/auth/me` - Get current user and family data (requires authentication)

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `PORT` | Server port | No (default: 3001) |
| `NODE_ENV` | Environment mode | No (default: development) |
| `FRONTEND_URL` | Frontend URL for CORS | No |
| `MOBILE_APP_URL` | Mobile app URL for CORS | No |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | Yes |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anonymous key | Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key | Yes |
| `STRIPE_SECRET_KEY` | Stripe secret key | Yes |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook secret | Yes |
| `OPENAI_API_KEY` | OpenAI API key | Yes |
| `PINECONE_API_KEY` | Pinecone API key | Yes |

## Migration from Next.js

This backend maintains the same API structure as your Next.js routes:

- **Same JSON input/output format**
- **Same authentication flow** with auth_token cookies
- **Same environment variable names**
- **Same Supabase integration**

## Adding New Routes

1. Create a new route file in `src/routes/`
2. Export a Router instance
3. Import and use in `src/index.ts`

Example:
```typescript
// src/routes/users.ts
import { Router } from 'express';
const router = Router();

router.get('/', (req, res) => {
  res.json({ users: [] });
});

export default router;

// src/index.ts
import userRoutes from './routes/users.js';
app.use('/api/users', userRoutes);
```

## Security Features

- **Helmet**: Security headers
- **CORS**: Cross-origin resource sharing
- **Rate Limiting**: 100 requests per 15 minutes per IP
- **Cookie Parser**: Secure cookie handling
- **Input Validation**: Request body parsing limits

## Development vs Production

- **Development**: Detailed error messages and stack traces
- **Production**: Sanitized error responses, no sensitive data exposure

## Next Steps

1. Migrate more routes from your Next.js API
2. Add input validation with Zod
3. Implement comprehensive logging
4. Add database migrations
5. Set up CI/CD pipeline 