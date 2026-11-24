import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

export interface SchemaRef {
  file: string;
  name: string;
  expression: string;
  inline?: 'empty-strict-object';
}
export interface Route {
  method: string;
  path: string;
  file: string;
  handler: string;
  middleware: string[];
  schemas: Partial<Record<'body' | 'query' | 'params', SchemaRef>>;
  upload?: string;
}
export function source(file: string) {
  return ts.createSourceFile(
    file,
    fs.readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
}
export function imported(sf: ts.SourceFile) {
  const result = new Map<string, { file: string; name: string }>();
  for (const node of sf.statements) {
    if (
      !ts.isImportDeclaration(node) ||
      !ts.isStringLiteralLike(node.moduleSpecifier) ||
      !node.moduleSpecifier.text.startsWith('.')
    )
      continue;
    const file = path.resolve(
      path.dirname(sf.fileName),
      node.moduleSpecifier.text.replace(/\.js$/, '.ts'),
    );
    if (node.importClause?.name)
      result.set(node.importClause.name.text, { file, name: 'default' });
    const bindings = node.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings))
      for (const item of bindings.elements)
        result.set(item.name.text, {
          file,
          name: item.propertyName?.text ?? item.name.text,
        });
  }
  return result;
}
export function literal(node: ts.Node | undefined): string | undefined {
  return node && ts.isStringLiteralLike(node) ? node.text : undefined;
}
export const join = (...parts: string[]) =>
  ('/' + parts.join('/')).replace(/\/+/g, '/').replace(/\/$/, '') || '/';
export function leafRoutes(file: string, prefix: string): Route[] {
  const sf = source(file),
    imports = imported(sf),
    routes: Route[] = [],
    middleware: string[] = [];
  const zodBindings = new Set<string>();
  for (const statement of sf.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteralLike(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === 'zod' &&
      !statement.importClause?.isTypeOnly
    ) {
      const bindings = statement.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings))
        for (const binding of bindings.elements)
          if (
            !binding.isTypeOnly &&
            (binding.propertyName ?? binding.name).text === 'z'
          )
            zodBindings.add(binding.name.text);
    }
  }
  const routers = new Set<string>();
  function find(node: ts.Node) {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isCallExpression(node.initializer) &&
      /^(Router|express.Router)$/.test(node.initializer.expression.getText(sf))
    )
      routers.add(node.name.text);
    ts.forEachChild(node, find);
  }
  find(sf);
  function walk(node: ts.Node, values = new Map<string, string>()) {
    if (
      ts.isForOfStatement(node) &&
      ts.isArrayLiteralExpression(node.expression) &&
      ts.isVariableDeclarationList(node.initializer)
    ) {
      const name = node.initializer.declarations[0]?.name.getText(sf);
      if (!name) throw new Error(`Unresolved loop in ${file}`);
      for (const item of node.expression.elements) {
        const value = literal(item);
        if (value === undefined)
          throw new Error(`Nonliteral route loop in ${file}`);
        walk(node.statement, new Map([...values, [name, value]]));
      }
      return;
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      routers.has(node.expression.expression.text)
    ) {
      const method = node.expression.name.text;
      if (method === 'use') {
        if (literal(node.arguments[0]) !== undefined)
          throw new Error(
            `Audit path-scoped middleware before generating: ${file}`,
          );
        middleware.push(...node.arguments.map((arg) => arg.getText(sf)));
        return;
      }
      if (
        ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'].includes(
          method,
        )
      ) {
        const first = node.arguments[0];
        const local =
          literal(first) ??
          (first && ts.isIdentifier(first)
            ? values.get(first.text)
            : undefined);
        if (local === undefined)
          throw new Error(`Unresolved route path in ${file}`);
        const schemas: Route['schemas'] = {};
        const args = node.arguments.slice(1);
        for (const arg of args) {
          if (
            !ts.isCallExpression(arg) ||
            arg.expression.getText(sf) !== 'validate'
          )
            continue;
          const location = literal(arg.arguments[1]);
          const schema = arg.arguments[0];
          if (
            !schema ||
            (location !== 'body' &&
              location !== 'query' &&
              location !== 'params')
          )
            throw new Error(`Unresolved validation in ${file}`);
          const expression = schema.getText(sf);
          const name = expression.split('.')[0]!;
          const item = imports.get(name);
          if (item) {
            schemas[location] = { ...item, expression };
            continue;
          }
          if (
            ts.isCallExpression(schema) &&
            ts.isPropertyAccessExpression(schema.expression) &&
            ts.isIdentifier(schema.expression.expression) &&
            zodBindings.has(schema.expression.expression.text) &&
            schema.expression.name.text === 'strictObject' &&
            !schema.typeArguments?.length &&
            schema.arguments.length === 1 &&
            ts.isObjectLiteralExpression(schema.arguments[0]!) &&
            schema.arguments[0]!.properties.length === 0
          ) {
            schemas[location] = {
              file: path.resolve(file),
              name: 'strictObject',
              expression,
              inline: 'empty-strict-object',
            };
            continue;
          }
          throw new Error(`Unresolved schema ${name} in ${file} (${location})`);
        }
        const text = args.map((arg) => arg.getText(sf)).join('\n');
        const upload = text.match(/\.single\(['"]([^'"]+)['"]\)/)?.[1];
        routes.push({
          method: method.toUpperCase(),
          path: join(prefix, local),
          file,
          handler: args.at(-1)?.getText(sf) ?? '',
          middleware: [
            ...middleware,
            ...args.slice(0, -1).map((arg) => arg.getText(sf)),
          ],
          schemas,
          ...(upload ? { upload } : {}),
        });
        return;
      }
    }
    ts.forEachChild(node, (child) => walk(child, values));
  }
  walk(sf);
  return routes;
}
export function discoverRoutes(): Route[] {
  const sf = source('src/routes/index.ts'),
    imports = imported(sf),
    routes: Route[] = [];
  for (const statement of sf.statements) {
    if (
      !ts.isExpressionStatement(statement) ||
      !ts.isCallExpression(statement.expression)
    )
      continue;
    const call = statement.expression;
    if (call.expression.getText(sf) !== 'router.use') continue;
    const router = call.arguments.at(-1)?.getText(sf),
      module = router ? imports.get(router) : undefined;
    if (!module)
      throw new Error(`Unresolved router mount: ${call.getText(sf)}`);
    const prefix = call.arguments.length > 1 ? literal(call.arguments[0]) : '';
    if (prefix === undefined) throw new Error('Nonliteral API router prefix');
    routes.push(...leafRoutes(module.file, join('/{{apiPrefix}}', prefix)));
  }
  const app = fs.readFileSync('src/app.ts', 'utf8');
  if (
    !app.includes("app.use('/ops', operationalRouter())") ||
    !app.includes('/payment-providers/myfatoorah')
  )
    throw new Error('Review changed app mounts');
  routes.push(...leafRoutes('src/common/observability/operations.ts', '/ops'));
  routes.push(
    ...leafRoutes(
      'src/modules/payments/myfatoorah.routes.ts',
      '/{{apiPrefix}}/payment-providers/myfatoorah',
    ),
  );
  const keys = routes.map((route) => `${route.method} ${route.path}`);
  if (new Set(keys).size !== keys.length)
    throw new Error('Duplicate source routes');
  return routes;
}
