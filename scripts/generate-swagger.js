import { generateOpenApi } from 'swagger-autogen-ast';
await generateOpenApi({
    entryFile: './src/app.ts',
    outputFile: './docs/openapi.json',
    tsconfigPath: './tsconfig.json',
    info: {
        title: 'Commerce API',
        version: '1.0.0',
        description: 'Production e-commerce REST API built with Node.js, TypeScript, Express, Prisma and PostgreSQL.',
    },
    servers: [
        {
            url: 'http://localhost:3000',
            description: 'Local development server',
        },
    ],
    components: {
        securitySchemes: {
            bearerAuth: {
                type: 'http',
                scheme: 'bearer',
                bearerFormat: 'JWT',
            },
        },
    },
});
//# sourceMappingURL=generate-swagger.js.map