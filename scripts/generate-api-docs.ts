import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

import {
  OpenAPIRegistry,
  OpenApiGeneratorV3,
  extendZodWithOpenApi,
} from '@asteasolutions/zod-to-openapi';

import { z } from 'zod';

extendZodWithOpenApi(z);

/* ============================================================
 * PATHS
 * ============================================================ */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const projectRoot = path.resolve(__dirname, '..');

const srcRoot = path.join(
  projectRoot,
  'src',
);

const outputDocsDir = path.join(
  projectRoot,
  'docs',
);

const outputPostmanDir = path.join(
  projectRoot,
  'postman',
);

const openApiOutput = path.join(
  outputDocsDir,
  'openapi.json',
);

const postmanOutput = path.join(
  outputPostmanDir,
  'commerce-api.postman_collection.json',
);

/* ============================================================
 * TYPES
 * ============================================================ */

type HttpMethod =
  | 'get'
  | 'post'
  | 'put'
  | 'patch'
  | 'delete'
  | 'options'
  | 'head';

type ValidationLocation =
  | 'body'
  | 'query'
  | 'params';

interface SchemaImport {
  identifier: string;
  modulePath: string;
}

interface RouteInfo {
  method: HttpMethod;
  path: string;

  schemaIdentifier?: string;
  schemaModulePath?: string;
  validationLocation?: ValidationLocation;

  authenticated: boolean;

  sourceFile: string;
}

interface RouteMount {
  variableName: string;
  prefix: string;
  routeFile: string;
}

/* ============================================================
 * FILE SYSTEM HELPERS
 * ============================================================ */

function ensureDirectory(
  directory: string,
): void {
  fs.mkdirSync(directory, {
    recursive: true,
  });
}

/* ============================================================
 * PATH HELPERS
 * ============================================================ */

function normalizePath(
  routePath: string,
): string {
  if (!routePath) {
    return '/';
  }

  if (routePath === '/') {
    return '/';
  }

  return routePath.startsWith('/')
    ? routePath
    : `/${routePath}`;
}

function joinPaths(
  prefix: string,
  routePath: string,
): string {
  const normalizedPrefix =
    prefix || '';

  const normalizedRoute =
    routePath || '';

  const combined =
    `${normalizedPrefix}/${normalizedRoute}`
      .replace(/\/+/g, '/');

  if (
    combined.length > 1 &&
    combined.endsWith('/')
  ) {
    return combined.slice(0, -1);
  }

  return combined.startsWith('/')
    ? combined
    : `/${combined}`;
}

function expressPathToOpenApi(
  expressPath: string,
): string {
  return expressPath.replace(
    /:([A-Za-z0-9_]+)/g,
    '{$1}',
  );
}

/* ============================================================
 * TYPESCRIPT AST HELPERS
 * ============================================================ */

function createSourceFile(
  filePath: string,
): ts.SourceFile {
  const source =
    fs.readFileSync(
      filePath,
      'utf8',
    );

  return ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
}

function getStringLiteralValue(
  node: ts.Node,
): string | undefined {
  if (
    ts.isStringLiteral(node) ||
    ts.isNoSubstitutionTemplateLiteral(node)
  ) {
    return node.text;
  }

  return undefined;
}

/* ============================================================
 * MODULE RESOLUTION
 * ============================================================ */

function resolveModulePath(
  sourceFile: string,
  importPath: string,
): string {
  const sourceDirectory =
    path.dirname(sourceFile);

  let resolved =
    importPath.replace(
      /\.js$/,
      '',
    );

  resolved =
    path.resolve(
      sourceDirectory,
      resolved,
    );

  const candidates = [
    `${resolved}.ts`,
    `${resolved}.tsx`,
    `${resolved}.js`,
    `${resolved}.mjs`,
    path.join(
      resolved,
      'index.ts',
    ),
  ];

  for (
    const candidate of candidates
  ) {
    if (
      fs.existsSync(candidate)
    ) {
      return candidate;
    }
  }

  throw new Error(
    `Cannot resolve module "${importPath}" from "${sourceFile}"`,
  );
}

/* ============================================================
 * FIND SCHEMA IMPORTS
 * ============================================================ */

function findSchemaImports(
  sourceFile: ts.SourceFile,
): SchemaImport[] {
  const result: SchemaImport[] = [];

  for (
    const statement of sourceFile.statements
  ) {
    if (
      !ts.isImportDeclaration(
        statement,
      )
    ) {
      continue;
    }

    const modulePath =
      getStringLiteralValue(
        statement.moduleSpecifier,
      );

    if (!modulePath) {
      continue;
    }

    if (
      !modulePath.includes('.schemas')
    ) {
      continue;
    }

    const importClause =
      statement.importClause;

    if (!importClause) {
      continue;
    }

    const namedBindings =
      importClause.namedBindings;

    if (
      !namedBindings ||
      !ts.isNamedImports(
        namedBindings,
      )
    ) {
      continue;
    }

    for (
      const element of namedBindings.elements
    ) {
      result.push({
        identifier:
          element.name.text,

        modulePath:
          resolveModulePath(
            sourceFile.fileName,
            modulePath,
          ),
      });
    }
  }

  return result;
}

/* ============================================================
 * FIND ROUTES IN ROUTE FILE
 * ============================================================ */

function findRoutesInFile(
  filePath: string,
): RouteInfo[] {
  const sourceFile =
    createSourceFile(filePath);

  const schemaImports =
    findSchemaImports(
      sourceFile,
    );

  const routes: RouteInfo[] = [];

  const supportedMethods: HttpMethod[] = [
    'get',
    'post',
    'put',
    'patch',
    'delete',
    'options',
    'head',
  ];

  function visit(
    node: ts.Node,
  ): void {
    if (
      !ts.isCallExpression(node)
    ) {
      ts.forEachChild(
        node,
        visit,
      );

      return;
    }

    if (
      !ts.isPropertyAccessExpression(
        node.expression,
      )
    ) {
      ts.forEachChild(
        node,
        visit,
      );

      return;
    }

    const method =
      node.expression.name.text;

    if (
      !supportedMethods.includes(
        method as HttpMethod,
      )
    ) {
      ts.forEachChild(
        node,
        visit,
      );

      return;
    }

    const args =
      node.arguments;

    if (
      args.length === 0
    ) {
      ts.forEachChild(
        node,
        visit,
      );

      return;
    }

    const routePath =
      getStringLiteralValue(
        args[0],
      );

    if (
      routePath === undefined
    ) {
      ts.forEachChild(
        node,
        visit,
      );

      return;
    }

    let schemaIdentifier:
      | string
      | undefined;

    let validationLocation:
      | ValidationLocation
      | undefined;

    let authenticated =
      false;

    for (
      let index = 1;
      index < args.length;
      index++
    ) {
      const argument =
        args[index];

      /*
       * Direct middleware:
       *
       * authenticate
       */
      if (
        ts.isIdentifier(argument)
      ) {
        if (
          argument.text ===
          'authenticate'
        ) {
          authenticated = true;
        }

        continue;
      }

      /*
       * Middleware call:
       *
       * validate(...)
       */
      if (
        !ts.isCallExpression(
          argument,
        )
      ) {
        continue;
      }

      if (
        !ts.isIdentifier(
          argument.expression,
        )
      ) {
        continue;
      }

      if (
        argument.expression.text !==
        'validate'
      ) {
        continue;
      }

      const validateArgs =
        argument.arguments;

      if (
        validateArgs.length < 2
      ) {
        continue;
      }

      const schemaArg =
        validateArgs[0];

      const locationArg =
        validateArgs[1];

      if (
        ts.isIdentifier(
          schemaArg,
        )
      ) {
        schemaIdentifier =
          schemaArg.text;
      }

      const location =
        getStringLiteralValue(
          locationArg,
        );

      if (
        location === 'body' ||
        location === 'query' ||
        location === 'params'
      ) {
        validationLocation =
          location;
      }
    }

    routes.push({
      method:
        method as HttpMethod,

      path:
        normalizePath(
          routePath,
        ),

      schemaIdentifier,

      validationLocation,

      authenticated,

      sourceFile:
        filePath,
    });

    ts.forEachChild(
      node,
      visit,
    );
  }

  visit(sourceFile);

  return routes.map(
    (route) => {
      if (
        !route.schemaIdentifier
      ) {
        return route;
      }

      const schemaImport =
        schemaImports.find(
          (item) =>
            item.identifier ===
            route.schemaIdentifier,
        );

      if (!schemaImport) {
        console.warn(
          `⚠ Schema "${route.schemaIdentifier}" was not found in ${filePath}`,
        );

        return route;
      }

      return {
        ...route,

        schemaModulePath:
          schemaImport.modulePath,
      };
    },
  );
}

/* ============================================================
 * FIND ROUTER MOUNTS
 * ============================================================ */

function findRouteMounts(): RouteMount[] {
  const indexFile =
    path.join(
      srcRoot,
      'routes',
      'index.ts',
    );

  if (
    !fs.existsSync(indexFile)
  ) {
    throw new Error(
      `Routes index file not found: ${indexFile}`,
    );
  }

  const sourceFile =
    createSourceFile(
      indexFile,
    );

  const importedRoutes =
    new Map<
      string,
      string
    >();

  for (
    const statement of sourceFile.statements
  ) {
    if (
      !ts.isImportDeclaration(
        statement,
      )
    ) {
      continue;
    }

    const modulePath =
      getStringLiteralValue(
        statement.moduleSpecifier,
      );

    if (!modulePath) {
      continue;
    }

    if (
      !modulePath.includes('.routes')
    ) {
      continue;
    }

    const importClause =
      statement.importClause;

    if (!importClause) {
      continue;
    }

    const defaultImport =
      importClause.name;

    if (!defaultImport) {
      continue;
    }

    const resolved =
      resolveModulePath(
        indexFile,
        modulePath,
      );

    importedRoutes.set(
      defaultImport.text,
      resolved,
    );
  }

  const mounts: RouteMount[] = [];

  function visit(
    node: ts.Node,
  ): void {
    if (
      !ts.isCallExpression(node)
    ) {
      ts.forEachChild(
        node,
        visit,
      );

      return;
    }

    if (
      !ts.isPropertyAccessExpression(
        node.expression,
      )
    ) {
      ts.forEachChild(
        node,
        visit,
      );

      return;
    }

    if (
      node.expression.name.text !==
      'use'
    ) {
      ts.forEachChild(
        node,
        visit,
      );

      return;
    }

    const args =
      node.arguments;

    if (
      args.length === 0
    ) {
      ts.forEachChild(
        node,
        visit,
      );

      return;
    }

    let prefix = '';

    let routeVariable:
      | string
      | undefined;

    if (
      args.length === 1
    ) {
      const routeArg =
        args[0];

      if (
        ts.isIdentifier(
          routeArg,
        )
      ) {
        routeVariable =
          routeArg.text;
      }
    }

    if (
      args.length >= 2
    ) {
      const first =
        getStringLiteralValue(
          args[0],
        );

      if (
        first !== undefined
      ) {
        prefix = first;
      }

      const routeArg =
        args[
          args.length - 1
        ];

      if (
        ts.isIdentifier(
          routeArg,
        )
      ) {
        routeVariable =
          routeArg.text;
      }
    }

    if (
      routeVariable &&
      importedRoutes.has(
        routeVariable,
      )
    ) {
      mounts.push({
        variableName:
          routeVariable,

        prefix,

        routeFile:
          importedRoutes.get(
            routeVariable,
          )!,
      });
    }

    ts.forEachChild(
      node,
      visit,
    );
  }

  visit(sourceFile);

  return mounts;
}

/* ============================================================
 * LOAD ZOD SCHEMA
 * ============================================================ */

async function loadSchema(
  modulePath: string,
  identifier: string,
): Promise<
  z.ZodTypeAny | undefined
> {
  try {
    const moduleUrl =
      pathToFileURL(
        modulePath,
      ).href;

    const module =
      await import(
        moduleUrl
      );

    const schema =
      module[identifier];

    if (!schema) {
      console.warn(
        `⚠ Schema "${identifier}" was not exported from ${modulePath}`,
      );

      return undefined;
    }

    return schema as z.ZodTypeAny;
  } catch (error) {
    console.warn(
      `⚠ Could not load schema "${identifier}"`,
      error,
    );

    return undefined;
  }
}

/* ============================================================
 * ZOD HELPERS
 * ============================================================ */

function getZodDef(
  schema: unknown,
): any {
  const schemaAny =
    schema as any;

  return (
    schemaAny?._zod?.def ??
    schemaAny?._def
  );
}

function getZodTypeName(
  schema: unknown,
): string | undefined {
  const def =
    getZodDef(schema);

  if (!def) {
    return undefined;
  }

  return (
    def.typeName ??
    def.type
  );
}

/* ============================================================
 * ZOD OBJECT SHAPE
 * ============================================================ */

function getZodObjectShape(
  schema: z.ZodTypeAny,
): Record<
  string,
  z.ZodTypeAny
> | undefined {
  const def =
    getZodDef(schema);

  if (!def) {
    return undefined;
  }

  const typeName =
    getZodTypeName(schema);

  if (
    typeName !== 'ZodObject' &&
    typeName !== 'object'
  ) {
    return undefined;
  }

  if (
    typeof def.shape ===
    'function'
  ) {
    return def.shape();
  }

  if (
    def.shape &&
    typeof def.shape ===
      'object'
  ) {
    return def.shape;
  }

  return undefined;
}

/* ============================================================
 * ZOD OPTIONAL
 * ============================================================ */

function isZodOptional(
  schema: z.ZodTypeAny,
): boolean {
  const typeName =
    getZodTypeName(schema);

  return (
    typeName === 'ZodOptional' ||
    typeName === 'optional'
  );
}

/* ============================================================
 * GENERATE EXAMPLE FROM ZOD
 * ============================================================ */

function generateExampleFromZod(
  schema: z.ZodTypeAny,
): unknown {
  const def =
    getZodDef(schema);

  if (!def) {
    return undefined;
  }

  const typeName =
    getZodTypeName(schema);

  switch (typeName) {
    case 'ZodObject':
    case 'object': {
      const shape =
        getZodObjectShape(
          schema,
        );

      if (!shape) {
        return {};
      }

      const result:
        Record<
          string,
          unknown
        > = {};

      for (
        const [
          key,
          value,
        ] of Object.entries(
          shape,
        )
      ) {
        const example =
          generateExampleFromZod(
            value as z.ZodTypeAny,
          );

        if (
          example !== undefined
        ) {
          result[key] =
            example;
        }
      }

      return result;
    }

    case 'ZodString':
    case 'string': {
      const checks =
        def.checks ?? [];

      const hasEmail =
        checks.some(
          (check: any) =>
            check.kind ===
              'email' ||
            check.format ===
              'email' ||
            (
              check.check ===
                'string_format' &&
              check.format ===
                'email'
            ),
        );

      if (hasEmail) {
        return 'user@example.com';
      }

      return 'string';
    }

    case 'ZodNumber':
    case 'number':
      return 1;

    case 'ZodInt':
    case 'int':
      return 1;

    case 'ZodBoolean':
    case 'boolean':
      return true;

    case 'ZodArray':
    case 'array': {
      const element =
        def.element;

      if (!element) {
        return [];
      }

      const example =
        generateExampleFromZod(
          element,
        );

      return example === undefined
        ? []
        : [example];
    }

    case 'ZodEnum':
    case 'enum': {
      if (
        def.entries &&
        typeof def.entries ===
          'object'
      ) {
        const values =
          Object.values(
            def.entries,
          );

        return (
          values[0] ??
          'VALUE'
        );
      }

      if (
        Array.isArray(
          def.values,
        )
      ) {
        return (
          def.values[0] ??
          'VALUE'
        );
      }

      return 'VALUE';
    }

    case 'ZodLiteral':
    case 'literal':
      return def.value;

    case 'ZodDefault':
    case 'default': {
      const defaultValue =
        def.defaultValue;

      /*
       * Some Zod versions expose
       * defaultValue as a function.
       */
      if (
        typeof defaultValue ===
        'function'
      ) {
        return defaultValue();
      }

      /*
       * Zod 4 may expose the
       * actual value directly.
       */
      return defaultValue;
    }

    case 'ZodOptional':
    case 'optional':
      return undefined;

    case 'ZodNullable':
    case 'nullable': {
      const innerType =
        def.innerType;

      if (!innerType) {
        return null;
      }

      const example =
        generateExampleFromZod(
          innerType,
        );

      return example === undefined
        ? null
        : example;
    }

    case 'ZodUnion':
    case 'union': {
      const options =
        def.options ?? [];

      if (
        options.length === 0
      ) {
        return undefined;
      }

      return generateExampleFromZod(
        options[0],
      );
    }

    case 'ZodDiscriminatedUnion': {
      const options =
        def.options;

      if (
        options instanceof Map
      ) {
        const first =
          options.values()
            .next()
            .value;

        if (first) {
          return generateExampleFromZod(
            first,
          );
        }
      }

      return undefined;
    }

    case 'ZodPipe':
    case 'pipe': {
      const inner =
        def.in ??
        def.out;

      if (!inner) {
        return undefined;
      }

      return generateExampleFromZod(
        inner,
      );
    }

    case 'ZodTransform':
    case 'transform':
      return 'string';

    case 'ZodDate':
    case 'date':
      return '2026-01-01T00:00:00.000Z';

    case 'ZodBigInt':
    case 'bigint':
      return '1';

    case 'ZodRecord':
    case 'record':
      return {};

    default:
      return undefined;
  }
}

/* ============================================================
 * CONVERT ZOD PROPERTY TO OPENAPI SCHEMA
 *
 * IMPORTANT:
 *
 * We do NOT pass Zod query/path properties directly
 * to zod-to-openapi.
 *
 * This avoids the Zod 4 registry/metadata problem.
 * ============================================================ */

function zodToOpenApiSchema(
  schema: z.ZodTypeAny,
): Record<string, unknown> {
  const def =
    getZodDef(schema);

  if (!def) {
    return {};
  }

  const typeName =
    getZodTypeName(schema);

  switch (typeName) {
    case 'ZodString':
    case 'string': {
      const result:
        Record<string, unknown> = {
          type: 'string',
        };

      const checks =
        def.checks ?? [];

      const hasEmail =
        checks.some(
          (check: any) =>
            check.kind ===
              'email' ||
            check.format ===
              'email' ||
            (
              check.check ===
                'string_format' &&
              check.format ===
                'email'
            ),
        );

      if (hasEmail) {
        result.format =
          'email';
      }

      const example =
        generateExampleFromZod(
          schema,
        );

      if (
        example !== undefined
      ) {
        result.example =
          example;
      }

      return result;
    }

    case 'ZodNumber':
    case 'number': {
      const result:
        Record<string, unknown> = {
          type: 'number',
        };

      const example =
        generateExampleFromZod(
          schema,
        );

      if (
        example !== undefined
      ) {
        result.example =
          example;
      }

      return result;
    }

    case 'ZodInt':
    case 'int':
      return {
        type: 'integer',
        example:
          generateExampleFromZod(
            schema,
          ),
      };

    case 'ZodBoolean':
    case 'boolean':
      return {
        type: 'boolean',
        example:
          generateExampleFromZod(
            schema,
          ),
      };

    case 'ZodEnum':
    case 'enum': {
      let values:
        unknown[] = [];

      if (
        def.entries &&
        typeof def.entries ===
          'object'
      ) {
        values =
          Object.values(
            def.entries,
          );
      } else if (
        Array.isArray(
          def.values,
        )
      ) {
        values =
          def.values;
      }

      return {
        type: 'string',
        enum: values,
        example:
          values[0],
      };
    }

    case 'ZodLiteral':
    case 'literal':
      return {
        type:
          typeof def.value,
        enum: [
          def.value,
        ],
        example:
          def.value,
      };

    case 'ZodArray':
    case 'array': {
      const element =
        def.element;

      return {
        type: 'array',

        items: element
          ? zodToOpenApiSchema(
              element,
            )
          : {},
      };
    }

    case 'ZodNullable':
    case 'nullable': {
      const inner =
        def.innerType;

      if (!inner) {
        return {};
      }

      return {
        ...zodToOpenApiSchema(
          inner,
        ),

        nullable: true,
      };
    }

    case 'ZodOptional':
    case 'optional': {
      const inner =
        def.innerType ??
        (
          typeof def.unwrap ===
          'function'
            ? def.unwrap()
            : undefined
        );

      if (!inner) {
        return {};
      }

      return zodToOpenApiSchema(
        inner,
      );
    }

    case 'ZodDefault':
    case 'default': {
      const inner =
        def.innerType;

      if (!inner) {
        return {};
      }

      const defaultValue =
        typeof def.defaultValue ===
        'function'
          ? def.defaultValue()
          : def.defaultValue;

      return {
        ...zodToOpenApiSchema(
          inner,
        ),

        default:
          defaultValue,
      };
    }

    case 'ZodDate':
    case 'date':
      return {
        type: 'string',

        format:
          'date-time',

        example:
          generateExampleFromZod(
            schema,
          ),
      };

    case 'ZodBigInt':
    case 'bigint':
      return {
        type: 'integer',

        format:
          'int64',

        example:
          generateExampleFromZod(
            schema,
          ),
      };

    case 'ZodUnion':
    case 'union': {
      const options =
        def.options ?? [];

      return {
        anyOf:
          options.map(
            (
              option: z.ZodTypeAny,
            ) =>
              zodToOpenApiSchema(
                option,
              ),
          ),
      };
    }

    default:
      return {};
  }
}

/* ============================================================
 * BUILD POSTMAN PARAMETERS
 *
 * Query parameters
 * ============================================================ */

function buildPostmanParameters(
  schema: z.ZodTypeAny,
): any[] {
  const result: any[] = [];

  const shape =
    getZodObjectShape(
      schema,
    );

  if (!shape) {
    return result;
  }

  for (
    const [
      name,
      propertySchema,
    ] of Object.entries(
      shape,
    )
  ) {
    const value =
      generateExampleFromZod(
        propertySchema,
      );

    result.push({
      key: name,

      value:
        value === undefined
          ? ''
          : String(value),

      type: 'text',

      enabled: true,
    });
  }

  return result;
}

/* ============================================================
 * BUILD POSTMAN PATH VARIABLES
 * ============================================================ */

function buildPostmanPathVariables(
  expressPath: string,
  schema:
    | z.ZodTypeAny
    | undefined,
): any[] {
  const matches =
    expressPath.match(
      /:([A-Za-z0-9_]+)/g,
    ) ?? [];

  if (
    matches.length === 0
  ) {
    return [];
  }

  const schemaShape =
    schema
      ? getZodObjectShape(
          schema,
        )
      : undefined;

  return matches.map(
    (match) => {
      const key =
        match.substring(1);

      const propertySchema =
        schemaShape?.[key];

      const value =
        propertySchema
          ? generateExampleFromZod(
              propertySchema,
            )
          : '';

      return {
        key,

        value:
          value === undefined
            ? ''
            : String(value),
      };
    },
  );
}

/* ============================================================
 * BUILD POSTMAN REQUEST
 * ============================================================ */

function buildPostmanRequest(
  route: RouteInfo,
  schema:
    | z.ZodTypeAny
    | undefined,
): any {
  const openApiPath =
    expressPathToOpenApi(
      route.path,
    );

  const request: any = {
    method:
      route.method.toUpperCase(),

    header: [],

    url: {
      raw:
        `{{baseUrl}}${openApiPath}`,

      host: [
        '{{baseUrl}}',
      ],

      path:
        openApiPath
          .split('/')
          .filter(Boolean),
    },
  };

  /* ----------------------------------------------------------
   * AUTHENTICATION
   * ---------------------------------------------------------- */

  if (
    route.authenticated
  ) {
    request.auth = {
      type: 'bearer',

      bearer: [
        {
          key: 'token',

          value:
            '{{accessToken}}',

          type: 'string',
        },
      ],
    };
  }

  /* ----------------------------------------------------------
   * BODY
   * ---------------------------------------------------------- */

  if (
    schema &&
    route.validationLocation ===
      'body'
  ) {
    const example =
      generateExampleFromZod(
        schema,
      );

    request.header.push({
      key:
        'Content-Type',

      value:
        'application/json',
    });

    request.body = {
      mode: 'raw',

      raw:
        JSON.stringify(
          example ?? {},
          null,
          2,
        ),

      options: {
        raw: {
          language:
            'json',
        },
      },
    };
  }

  /* ----------------------------------------------------------
   * QUERY
   * ---------------------------------------------------------- */

  if (
    schema &&
    route.validationLocation ===
      'query'
  ) {
    request.url.query =
      buildPostmanParameters(
        schema,
      );
  }

  /* ----------------------------------------------------------
   * PATH PARAMETERS
   * ---------------------------------------------------------- */

  request.url.variable =
    buildPostmanPathVariables(
      route.path,

      route.validationLocation ===
        'params'
        ? schema
        : undefined,
    );

  return request;
}

/* ============================================================
 * MAIN
 * ============================================================ */

async function main(): Promise<void> {
  console.log(
    '\n🚀 Generating API documentation...\n',
  );

  ensureDirectory(
    outputDocsDir,
  );

  ensureDirectory(
    outputPostmanDir,
  );

  /* ==========================================================
   * FIND ROUTE MODULES
   * ========================================================== */

  const mounts =
    findRouteMounts();

  console.log(
    `📂 Found ${mounts.length} route modules`,
  );

  /* ==========================================================
   * FIND ROUTES
   * ========================================================== */

  const allRoutes:
    RouteInfo[] = [];

  for (
    const mount of mounts
  ) {
    const routes =
      findRoutesInFile(
        mount.routeFile,
      );

    for (
      const route of routes
    ) {
      allRoutes.push({
        ...route,

        path:
          joinPaths(
            mount.prefix,
            route.path,
          ),
      });
    }
  }

  console.log(
    `🛣️  Found ${allRoutes.length} routes`,
  );

  /* ==========================================================
   * OPENAPI REGISTRY
   * ========================================================== */

  const registry =
    new OpenAPIRegistry();

  /* ==========================================================
   * GROUP ROUTES
   * ========================================================== */

  const groupedRoutes =
    new Map<
      string,
      RouteInfo[]
    >();

  for (
    const route of allRoutes
  ) {
    const firstSegment =
      route.path
        .split('/')
        .filter(Boolean)[0] ??
      'root';

    const existing =
      groupedRoutes.get(
        firstSegment,
      ) ?? [];

    existing.push(route);

    groupedRoutes.set(
      firstSegment,
      existing,
    );
  }

  const postmanItems:
    any[] = [];

  /* ==========================================================
   * PROCESS ROUTES
   * ========================================================== */

  for (
    const [
      groupName,
      routes,
    ] of groupedRoutes
  ) {
    const groupItems:
      any[] = [];

    for (
      const route of routes
    ) {
      let schema:
        | z.ZodTypeAny
        | undefined;

      if (
        route.schemaIdentifier &&
        route.schemaModulePath
      ) {
        schema =
          await loadSchema(
            route.schemaModulePath,
            route.schemaIdentifier,
          );
      }

      const openApiPath =
        expressPathToOpenApi(
          route.path,
        );

      /* --------------------------------------------------------
       * OPENAPI OPERATION
       * -------------------------------------------------------- */

      const operation: any = {
        summary:
          `${route.method.toUpperCase()} ${route.path}`,

        operationId:
          `${route.method}_${route.path
            .replace(
              /[{}]/g,
              '',
            )
            .replace(
              /[^a-zA-Z0-9]+/g,
              '_',
            )
            .replace(
              /^_|_$/g,
              '',
            )}`,

        tags: [
          groupName,
        ],

        responses: {
          '200': {
            description:
              'Successful response',
          },
        },
      };

      /* --------------------------------------------------------
       * AUTHENTICATION
       * -------------------------------------------------------- */

      if (
        route.authenticated
      ) {
        operation.security = [
          {
            bearerAuth: [],
          },
        ];
      }

      /* --------------------------------------------------------
       * REQUEST BODY
       *
       * Keep Zod schema here.
       * zod-to-openapi handles request bodies.
       * -------------------------------------------------------- */

      if (
        schema &&
        route.validationLocation ===
          'body'
      ) {
        operation.request = {
          body: {
            content: {
              'application/json': {
                schema,
              },
            },
          },
        };
      }

      /* --------------------------------------------------------
       * QUERY PARAMETERS
       *
       * IMPORTANT:
       *
       * These are plain OpenAPI schemas.
       * We do NOT pass Zod schemas here.
       * -------------------------------------------------------- */

      if (
        schema &&
        route.validationLocation ===
          'query'
      ) {
        const shape =
          getZodObjectShape(
            schema,
          );

        if (shape) {
          operation.parameters =
            Object.entries(
              shape,
            ).map(
              ([
                name,
                propertySchema,
              ]) => ({
                name,

                in: 'query',

                required:
                  !isZodOptional(
                    propertySchema,
                  ),

                schema:
                  zodToOpenApiSchema(
                    propertySchema,
                  ),

                example:
                  generateExampleFromZod(
                    propertySchema,
                  ),
              }),
            );
        }
      }

      /* --------------------------------------------------------
       * PATH PARAMETERS
       *
       * IMPORTANT:
       *
       * These are plain OpenAPI schemas.
       * We do NOT pass Zod schemas here.
       * -------------------------------------------------------- */

      if (
        schema &&
        route.validationLocation ===
          'params'
      ) {
        const shape =
          getZodObjectShape(
            schema,
          );

        if (shape) {
          operation.parameters =
            Object.entries(
              shape,
            ).map(
              ([
                name,
                propertySchema,
              ]) => ({
                name,

                in: 'path',

                required: true,

                schema:
                  zodToOpenApiSchema(
                    propertySchema,
                  ),

                example:
                  generateExampleFromZod(
                    propertySchema,
                  ),
              }),
            );
        }
      }

      /* --------------------------------------------------------
       * REGISTER OPENAPI PATH
       * -------------------------------------------------------- */

      try {
        registry.registerPath({
          method:
            route.method,

          path:
            openApiPath,

          ...operation,
        } as any);
      } catch (error) {
        console.warn(
          `⚠ Could not register OpenAPI path ${route.method.toUpperCase()} ${openApiPath}`,
        );

        console.warn(error);
      }

      /* --------------------------------------------------------
       * POSTMAN
       * -------------------------------------------------------- */

      const postmanRequest =
        buildPostmanRequest(
          route,
          schema,
        );

      groupItems.push({
        name:
          `${route.method.toUpperCase()} ${route.path}`,

        request:
          postmanRequest,
      });
    }

    postmanItems.push({
      name:
        groupName,

      item:
        groupItems,
    });
  }

  /* ==========================================================
   * GENERATE OPENAPI DOCUMENT
   * ========================================================== */

  const generator =
    new OpenApiGeneratorV3(
      registry.definitions,
    );

  const openApiDocument =
    generator.generateDocument({
      openapi:
        '3.0.0',

      info: {
        title:
          'Commerce API',

        version:
          '1.0.0',

        description:
          'Automatically generated Commerce API documentation from Express routes and Zod validation schemas.',
      },

      servers: [
        {
          url:
            'http://localhost:3000/api/v1',
        },
      ],

      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',

            scheme:
              'bearer',

            bearerFormat:
              'JWT',
          },
        },
      },
    });

  /* ==========================================================
   * SAVE OPENAPI
   * ========================================================== */

  fs.writeFileSync(
    openApiOutput,

    JSON.stringify(
      openApiDocument,
      null,
      2,
    ),

    'utf8',
  );

  /* ==========================================================
   * POSTMAN COLLECTION
   * ========================================================== */

  const postmanCollection = {
    info: {
      name:
        'Commerce API',

      description:
        'Automatically generated Postman collection from Express routes and Zod validation schemas.',

      schema:
        'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },

    variable: [
      {
        key:
          'baseUrl',

        value:
          'http://localhost:3000/api/v1',
      },

      {
        key:
          'accessToken',

        value:
          '',
      },

      {
        key:
          'refreshToken',

        value:
          '',
      },

      {
        key:
          'userId',

        value:
          '',
      },

      {
        key:
          'productId',

        value:
          '',
      },

      {
        key:
          'variantId',

        value:
          '',
      },

      {
        key:
          'orderId',

        value:
          '',
      },
    ],

    item:
      postmanItems,
  };

  /* ==========================================================
   * SAVE POSTMAN
   * ========================================================== */

  fs.writeFileSync(
    postmanOutput,

    JSON.stringify(
      postmanCollection,
      null,
      2,
    ),

    'utf8',
  );

  /* ==========================================================
   * SUMMARY
   * ========================================================== */

  console.log(
    '\n✅ API documentation generated successfully!\n',
  );

  console.log(
    `📄 OpenAPI:\n   ${openApiOutput}`,
  );

  console.log(
    `📦 Postman:\n   ${postmanOutput}`,
  );

  console.log(
    `\n📊 Routes: ${allRoutes.length}`,
  );

  console.log(
    `📁 Route modules: ${mounts.length}`,
  );

  console.log(
    '\n✨ Done.\n',
  );
}

/* ============================================================
 * RUN
 * ============================================================ */

main().catch(
  (error) => {
    console.error(
      '\n❌ Failed to generate API documentation:\n',
      error,
    );

    process.exit(1);
  },
);