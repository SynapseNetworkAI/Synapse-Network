const fs = require('fs');
let code = fs.readFileSync('src/app/dashboard/services/page.tsx', 'utf8');

// remove agentStore, AgentIdentity, listAgents imports
code = code.replace(/import \{ agentStore, AgentIdentity \} from "@\/utils\/agentStore";\n/g, '');
code = code.replace(/import \{ listAgents \} from "@\/utils\/agentApi";\n/g, '');

// update loadAll to remove agents fetch
code = code.replace(/const serverAgents = await listAgents\(userAddress\);[\s\S]*?if \(!formAgentId[\s\S]*?\}/g, '');

console.log('Done script generation');
