import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import type { IconUsage } from '../../types.js';

export async function parseFileImports(
  filePath: string,
  iconPattern: RegExp,
  extractNamed = false,
): Promise<IconUsage[]> {
  const ts = (await import('typescript')).default ?? await import('typescript');
  const raw = await readFile(filePath, 'utf-8');

  const ext = extname(filePath);
  const scriptKindMap: Record<string, number> = {
    '.ts': ts.ScriptKind.TS,
    '.tsx': ts.ScriptKind.TSX,
    '.js': ts.ScriptKind.JS,
    '.jsx': ts.ScriptKind.JSX,
  };

  const sourceFile = ts.createSourceFile(
    filePath,
    raw,
    ts.ScriptTarget.Latest,
    true,
    scriptKindMap[ext] ?? ts.ScriptKind.TS,
  );

  const results: IconUsage[] = [];

  function getLine(node: { getStart(): number }): number {
    return sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
  }

  function processSpecifier(moduleSpecifier: string, node: any, importStatement?: any): void {
    iconPattern.lastIndex = 0;
    const iconMatch = iconPattern.exec(moduleSpecifier);
    if (!iconMatch) return;

    if (extractNamed) {
      const prefix = iconMatch[1] || '';

      if (importStatement) {
        // Static import/export: extract named bindings
        const clause = importStatement.importClause;
        if (clause?.namedBindings) {
          if (ts.isNamedImports(clause.namedBindings)) {
            for (const element of clause.namedBindings.elements) {
              const name = (element.propertyName ?? element.name).getText(sourceFile);
              results.push({
                name: prefix ? `${prefix}/${name}` : name,
                source: filePath,
                line: getLine(node),
              });
            }
          } else if (ts.isNamespaceImport(clause.namedBindings)) {
            // import * as X — not statically analyzable
            return;
          }
        }

        // Handle export { A, B } from 'mod'
        if (ts.isExportDeclaration(importStatement) && importStatement.exportClause) {
          if (ts.isNamedExports(importStatement.exportClause)) {
            for (const element of importStatement.exportClause.elements) {
              const name = (element.propertyName ?? element.name).getText(sourceFile);
              results.push({
                name: prefix ? `${prefix}/${name}` : name,
                source: filePath,
                line: getLine(node),
              });
            }
          }
        }
      }
    } else if (iconMatch[1]) {
      results.push({
        name: iconMatch[1],
        source: filePath,
        line: getLine(node),
      });
    }
  }

  function visit(node: any): void {
    // Static imports: import ... from 'mod'
    if (ts.isImportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      processSpecifier(node.moduleSpecifier.text, node, node);
    }

    // Exports: export { ... } from 'mod', export * from 'mod'
    if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      processSpecifier(node.moduleSpecifier.text, node, node);
    }

    // Dynamic imports: import('mod'), require('mod')
    if (ts.isCallExpression(node)) {
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require';

      if ((isDynamicImport || isRequire) && node.arguments.length > 0) {
        const arg = node.arguments[0];
        if (ts.isStringLiteral(arg)) {
          const moduleSpecifier = arg.text;
          iconPattern.lastIndex = 0;
          const iconMatch = iconPattern.exec(moduleSpecifier);

          if (iconMatch) {
            if (extractNamed) {
              const prefix = iconMatch[1] || '';
              const names = extractDynamicNames(node, ts, sourceFile);
              for (const name of names) {
                results.push({
                  name: prefix ? `${prefix}/${name}` : name,
                  source: filePath,
                  line: getLine(node),
                });
              }
            } else if (iconMatch[1]) {
              results.push({
                name: iconMatch[1],
                source: filePath,
                line: getLine(node),
              });
            }
          }
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return results;
}

function extractDynamicNames(callNode: any, ts: any, sourceFile: any): string[] {
  const names: string[] = [];
  const parent = callNode.parent;

  // Pattern: const { A, B } = await import('mod')
  if (parent && ts.isAwaitExpression(parent)) {
    const varDecl = parent.parent;
    if (varDecl && ts.isVariableDeclaration(varDecl) && ts.isObjectBindingPattern(varDecl.name)) {
      for (const element of varDecl.name.elements) {
        const name = (element.propertyName ?? element.name).getText(sourceFile);
        if (!names.includes(name)) names.push(name);
      }
      return names;
    }
  }

  // Pattern: import('mod').then(({ A, B }) => ...) or .then(m => m.A)
  if (parent && ts.isPropertyAccessExpression(parent) && parent.name.text === 'then') {
    const thenCall = parent.parent;
    if (thenCall && ts.isCallExpression(thenCall) && thenCall.arguments.length > 0) {
      const callback = thenCall.arguments[0];
      if (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) {
        const params = callback.parameters;
        if (params.length > 0) {
          const param = params[0];
          // Destructured: ({ A, B }) => ...
          if (ts.isObjectBindingPattern(param.name)) {
            for (const element of param.name.elements) {
              const name = (element.propertyName ?? element.name).getText(sourceFile);
              if (!names.includes(name)) names.push(name);
            }
            return names;
          }
          // Member access: (m) => m.A or (m) => ({ default: m.A })
          if (ts.isIdentifier(param.name)) {
            const paramName = param.name.text;
            collectMemberAccesses(callback.body, paramName, ts, sourceFile, names);
            return names;
          }
        }
      }
    }
  }

  return names;
}

function collectMemberAccesses(node: any, paramName: string, ts: any, sourceFile: any, names: string[]): void {
  if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === paramName) {
    const name = node.name.getText(sourceFile);
    if (/^[A-Z]/.test(name) && !names.includes(name)) {
      names.push(name);
    }
  }
  ts.forEachChild(node, (child: any) => collectMemberAccesses(child, paramName, ts, sourceFile, names));
}
