import os
import re

def process_file(filepath):
    # Only process text files (assuming no binary like images)
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()
    except UnicodeDecodeError:
        return

    orig_content = content
    
    # 1. pip install a2a-pay -> pip install synapse-client
    content = re.sub(r'pip install a2a-pay', 'pip install synapse-client', content)
    
    # 2. pip install agentpay -> pip install synapse-client
    content = re.sub(r'pip install agentpay', 'pip install synapse-client', content)
    
    # 3. AgentPayClient -> SynapseClient
    content = re.sub(r'AgentPayClient', 'SynapseClient', content)
    
    # 4. agentpay_buyer_sdk -> synapse_client
    content = re.sub(r'agentpay_buyer_sdk', 'synapse_client', content)
    
    # 5. AgentPay -> Synapse Network
    content = re.sub(r'AgentPay', 'Synapse Network', content)
    
    # 6. agentpay -> synapse (for lowercases if any in text, but maybe risky, skip generic agentpay, wait let's just do AgentPay)
    
    # Clean up awkward formatting if it happens: Synapse NetworkClient -> SynapseClient
    content = re.sub(r'Synapse NetworkClient', 'SynapseClient', content)
    # Synapse Network_Vault -> Synapse_Vault
    content = re.sub(r'Synapse Network_Vault', 'Synapse_Vault', content)
    
    # X-AgentPay-Cost -> X-Synapse-Cost
    content = re.sub(r'X-Synapse Network-Cost', 'X-Synapse-Cost', content)
    content = re.sub(r'X-Synapse Network-Balance', 'X-Synapse-Balance', content)

    # What is Synapse Network? -> What is Synapse Network? (Already done by AgentPay replacement)
    
    if content != orig_content:
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(content)
        print(f"Updated {filepath}")

def walk_dir(directory):
    for root, dirs, files in os.walk(directory):
        # skip python caches, node_modules, git
        if '__pycache__' in root or 'node_modules' in root or '.git' in root or '.next' in root or 'artifacts' in root or 'cache' in root or 'egg-info' in root:
            continue
            
        for file in files:
            if file.endswith(('.py', '.js', '.ts', '.tsx', '.md', '.json', '.txt', '.toml')):
                process_file(os.path.join(root, file))

if __name__ == '__main__':
    project_root = '/Users/cliff/workspace/A2A-pay'
    walk_dir(os.path.join(project_root, 'frontend', 'src'))
    walk_dir(os.path.join(project_root, 'doc'))
    walk_dir(os.path.join(project_root, 'python_sdk'))