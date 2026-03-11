import os
import re

def process_file(filepath):
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()
    except UnicodeDecodeError:
        return

    orig_content = content
    
    content = re.sub(r'agentpay-buyer-sdk', 'synapse-client', content)
    content = re.sub(r'agentpay_buyer_sdk', 'synapse_client', content)
    content = re.sub(r'agentpay_client', 'synapse_client', content)
    content = re.sub(r'agentpay\.', 'synapse.', content)
    content = re.sub(r'agentpay =', 'synapse =', content)
    content = re.sub(r'AgentPayBuyer', 'SynapseBuyer', content)
    content = re.sub(r'AgentPayClient', 'SynapseClient', content)
    content = re.sub(r'Synapse NetworkBuyer', 'SynapseBuyer', content)
    content = re.sub(r'Synapse NetworkClient', 'SynapseClient', content)
    content = re.sub(r'gateway.agentpay.com', 'gateway.synapse.com', content)

    if content != orig_content:
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(content)
        print(f"Updated {filepath}")

def walk_dir(directory):
    for root, dirs, files in os.walk(directory):
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
