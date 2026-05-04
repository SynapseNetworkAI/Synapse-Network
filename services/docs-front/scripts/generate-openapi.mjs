#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

const APP_ROOT = resolveAppRoot();
const endpointDataPath = path.join(APP_ROOT, "src/data/endpoint-source.ts");
const publicOpenApiPath = path.join(APP_ROOT, "public/openapi.json");
const dataPath = path.join(APP_ROOT, "src/data/api-reference.json");
const sourceLabel = "services/docs-front/src/data/endpoint-source.ts";

function resolveAppRoot() {
  const cwd = process.cwd();
  const candidates = [cwd, path.join(cwd, "services/docs-front")];
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, "src/data/endpoint-source.ts"))) {
      return candidate;
    }
  }
  throw new Error(
    `Cannot locate docs-front endpoint source from ${cwd}. Expected src/data/endpoint-source.ts or services/docs-front/src/data/endpoint-source.ts.`
  );
}

function loadRouteGroups() {
  const source = fs.readFileSync(endpointDataPath, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;

  const sandbox = { exports: {} };
  vm.runInNewContext(output, sandbox, {
    filename: endpointDataPath,
    timeout: 1000,
  });

  if (!Array.isArray(sandbox.exports.ROUTE_GROUPS)) {
    throw new Error("ROUTE_GROUPS export was not found in endpoint-source.ts");
  }

  return sandbox.exports.ROUTE_GROUPS;
}

function normalizePath(routePath) {
  return routePath.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
}

function schemaForExample(example) {
  if (Array.isArray(example)) {
    return {
      type: "array",
      items:
        example.length > 0 ? schemaForExample(example[0]) : { type: "object" },
      example,
    };
  }

  if (example === null) return { nullable: true, example };

  switch (typeof example) {
    case "string":
      return { type: "string", example };
    case "number":
      return Number.isInteger(example)
        ? { type: "integer", example }
        : { type: "number", example };
    case "boolean":
      return { type: "boolean", example };
    case "object":
      return {
        type: "object",
        additionalProperties: true,
        example,
      };
    default:
      return { type: "object", example };
  }
}

function parameterToOpenApi(param) {
  return {
    name: param.name,
    in: param.in,
    required: Boolean(param.required),
    description: param.description,
    schema: {
      type:
        param.type === "integer" ||
        param.type === "number" ||
        param.type === "boolean"
          ? param.type
          : "string",
      enum: param.enum,
      example: param.example,
    },
  };
}

function buildOpenApi(groups) {
  const paths = {};

  for (const group of groups) {
    for (const route of group.routes) {
      const routePath = normalizePath(route.path);
      const method = route.method.toLowerCase();
      paths[routePath] ??= {};

      const successStatus = route.method === "POST" ? "201" : "200";
      const operation = {
        operationId: route.id,
        tags: [group.title],
        summary: route.summary,
        description: `${route.description}\n\nAgent policy: ${route.agentMeta.note}`,
        security:
          route.auth === "jwt"
            ? [{ bearerAuth: [] }]
            : route.auth === "credential"
            ? [{ agentCredential: [] }]
            : [],
        parameters: (route.params ?? [])
          .filter((param) => param.in !== "body")
          .map(parameterToOpenApi),
        responses: {
          [successStatus]: {
            description: route.summary,
            content: route.responseExample
              ? {
                  "application/json": {
                    schema: schemaForExample(route.responseExample),
                    example: route.responseExample,
                  },
                }
              : undefined,
          },
        },
        "x-synapse-role": route.agentMeta.role,
        "x-synapse-phase": route.agentMeta.phase,
        "x-synapse-idempotency": Boolean(route.idempotency),
        "x-synapse-base": route.base ?? "gateway",
      };

      if (route.bodyExample) {
        operation.requestBody = {
          required: true,
          content: {
            "application/json": {
              schema: schemaForExample(route.bodyExample),
              example: route.bodyExample,
            },
          },
        };
      }

      for (const error of route.errors ?? []) {
        operation.responses[String(error.status)] = {
          description: `${error.code}: ${error.message}`,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  code: { type: "string" },
                  message: { type: "string" },
                },
              },
              example: {
                code: error.code,
                message: error.message,
              },
            },
          },
        };
      }

      paths[routePath][method] = operation;
    }
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "Synapse Gateway API",
      version: "2026-05-02",
      description:
        "Agent-first USDC settlement API for service discovery, paid invocation, budget isolation, provider onboarding, and withdrawal evidence.",
    },
    servers: [
      {
        url: "http://127.0.0.1:8000",
        description: "Local / Hardhat",
      },
      {
        url: "https://api-staging.synapse-network.ai",
        description: "Staging / Arbitrum Sepolia",
      },
      {
        url: "https://api.synapse-network.ai",
        description: "Production",
      },
    ],
    tags: groups.map((group) => ({
      name: group.title,
      description: group.description,
    })),
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
        },
        agentCredential: {
          type: "apiKey",
          in: "header",
          name: "X-Synapse-Agent-Credential",
        },
      },
    },
    paths,
  };
}

function buildReferenceData(groups) {
  return {
    generatedAt: new Date().toISOString(),
    source: sourceLabel,
    groups,
    routes: groups.flatMap((group) =>
      group.routes.map((route) => ({
        ...route,
        groupId: group.id,
        groupTitle: group.title,
        openApiPath: normalizePath(route.path),
      }))
    ),
  };
}

const groups = loadRouteGroups();
const openapi = buildOpenApi(groups);
const referenceData = buildReferenceData(groups);

fs.mkdirSync(path.dirname(publicOpenApiPath), { recursive: true });
fs.mkdirSync(path.dirname(dataPath), { recursive: true });
fs.writeFileSync(publicOpenApiPath, `${JSON.stringify(openapi, null, 2)}\n`);
fs.writeFileSync(dataPath, `${JSON.stringify(referenceData, null, 2)}\n`);

console.log(
  `[docs-front] generated OpenAPI: ${groups.length} groups, ${referenceData.routes.length} routes`
);
