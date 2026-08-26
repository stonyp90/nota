'use strict';

// Contract-testing loader: read an OpenAPI 3.1 document, hand the WHOLE
// document to Ajv under a base id, then hand back a compiled validator for any
// `paths.<path>.<method>.responses.<status>` JSON schema — addressed by JSON
// pointer so the document's own local `$ref`s (`#/components/schemas/...`)
// resolve in place, with no hand-rolled deref of the schema graph.
//
// OpenAPI 3.1's schema dialect IS JSON Schema (2020-12); the few annotation-only
// keywords the spec carries (`example`, `writeOnly`, plus the OpenAPI object
// keys around the schemas) are unknown to Ajv but harmless — `strict:false`
// downgrades "unknown keyword" from throw to ignore. `nullable` is not used
// anywhere in this spec (it models nullability with `type:[t,"null"]`), so no
// adapter is needed; were it to appear, convert it here before addSchema.

const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');
const Ajv = require('ajv');
const addFormats = require('ajv-formats');

const BASE_ID = 'nota-openapi';
const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

// JSON-pointer escaping (RFC 6901): `~` -> `~0`, `/` -> `~1`.
function pointer(parts) {
  return '#/' + parts.map((p) => String(p).replace(/~/g, '~0').replace(/\//g, '~1')).join('/');
}

// OpenAPI 3.0's `nullable: true` is NOT a JSON-Schema keyword — Ajv would
// silently ignore it and then reject a legitimate `null`. Rewrite it in place
// to the 2020-12 idiom (`type: [..., "null"]`) the rest of the spec already
// uses, so a nullable field validates the same way whichever form the author
// wrote. Walks the whole document once, before it is handed to Ajv.
function adaptNullable(node) {
  if (Array.isArray(node)) return node.forEach(adaptNullable);
  if (!node || typeof node !== 'object') return;
  if (node.nullable === true) {
    if (typeof node.type === 'string') node.type = [node.type, 'null'];
    else if (Array.isArray(node.type) && !node.type.includes('null')) node.type.push('null');
  }
  delete node.nullable;
  for (const value of Object.values(node)) adaptNullable(value);
}

function loadContract(specPath) {
  const doc = yaml.load(fs.readFileSync(specPath, 'utf8'));
  adaptNullable(doc);
  const ajv = new Ajv({ strict: false, allErrors: true, validateSchema: false });
  addFormats(ajv);
  // The whole document is registered so any `#/...` pointer into it — including
  // the internal `$ref`s a response schema chases — resolves against one root.
  ajv.addSchema(doc, BASE_ID);

  // Follow a chain of local `$ref`s (`#/a/b/c`) to the object it names.
  function deref(ref) {
    if (typeof ref !== 'string' || !ref.startsWith('#/')) return null;
    return ref
      .slice(2)
      .split('/')
      .map((seg) => seg.replace(/~1/g, '/').replace(/~0/g, '~'))
      .reduce((node, seg) => (node == null ? node : node[seg]), doc);
  }

  // Every documented `<method> <path>` pair, for the routing-drift sweep.
  function documentedRoutes() {
    const out = [];
    for (const [p, item] of Object.entries(doc.paths || {})) {
      for (const m of METHODS) if (item[m]) out.push({ path: p, method: m.toUpperCase() });
    }
    return out;
  }

  // Resolve the response object for a status, chasing a `$ref` response
  // (`#/components/responses/Unauthorized`) and returning the pointer that
  // addresses its `application/json` schema in the document.
  function responseSchema(routePath, method, status) {
    const op = ((doc.paths || {})[routePath] || {})[String(method).toLowerCase()];
    if (!op) return { error: 'no-operation' };
    const resp = (op.responses || {})[String(status)];
    if (!resp) return { error: 'no-status' };

    let target = resp;
    let baseParts;
    if (resp.$ref) {
      target = deref(resp.$ref);
      baseParts = resp.$ref.slice(2).split('/'); // e.g. components/responses/Unauthorized
    } else {
      baseParts = ['paths', routePath, String(method).toLowerCase(), 'responses', String(status)];
    }
    if (!target) return { error: 'dangling-ref' };

    const content = target.content || {};
    const json = content['application/json'];
    if (!json || !json.schema) {
      // A legitimately schema-less response (text/html, or no body). Not drift.
      return { error: 'no-json-schema', contentTypes: Object.keys(content) };
    }
    const schemaParts = [...baseParts, 'content', 'application/json', 'schema'];
    return { pointerRef: BASE_ID + pointer(schemaParts) };
  }

  // Compiled validator for a response body, or a reason it has none.
  function validatorForResponse(routePath, method, status) {
    const found = responseSchema(routePath, method, status);
    if (found.error) return found;
    const validate = ajv.getSchema(found.pointerRef);
    if (!validate) return { error: 'compile-failed', pointerRef: found.pointerRef };
    return { validate };
  }

  return { doc, ajv, deref, documentedRoutes, responseSchema, validatorForResponse, pointer, BASE_ID };
}

module.exports = { loadContract, pointer };
// Resolve a spec file name relative to apps/api (cwd-independent).
module.exports.specPath = (name) => path.join(__dirname, '..', '..', name);
