import re

filepath = "/Users/cliff/workspace/A2A-pay/frontend/src/app/dashboard/services/deploy/page.tsx"
with open(filepath, "r") as f:
    text = f.read()

text = text.replace('X, ChevronLeft, Check', 'X, Check')
text = text.replace('const [aiPreviewMode, setAiPreviewMode] = useState(false);\n', '')
text = text.replace('const [aiGeneratedJson, setAiGeneratedJson] = useState("");\n', '')

with open(filepath, "w") as f:
    f.write(text)

print("Fixed deps")
