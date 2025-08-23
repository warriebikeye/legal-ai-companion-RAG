import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Legal AI Companion API',
      version: '1.0.0',
      description: 'API for voice/text legal assistant powered by RAG + Gemini/OpenAI',
    },
    servers: [
      {
        url: 'http://localhost:5000',
        description: 'Local development server',
      },
      {
        url: 'https://legal-ai-companion-rag.onrender.com',
        description: 'Production server',
      },
    ],
  },
  apis: ['./src/routes/*.js'], // This tells swagger-jsdoc where to look for comments
};

const specs = swaggerJsdoc(options);

export { swaggerUi, specs };
