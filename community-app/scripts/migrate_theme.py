import re, os

files = [
    "src/app/(tabs)/boards.tsx",
    "src/app/(tabs)/index.tsx",
    "src/app/(tabs)/messages.tsx",
    "src/app/(tabs)/profile.tsx",
    "src/app/(tabs)/publish.tsx",
    "src/app/blacklist.tsx",
    "src/app/chat/[name].tsx",
    "src/app/edit-profile.tsx",
    "src/app/login.tsx",
    "src/app/post/[id].tsx",
    "src/app/user-list.tsx",
    "src/app/user/[name].tsx",
    "src/components/confirm-modal.tsx",
    "src/components/post-actions.tsx",
]

color_map = {
    "#F5F6FA": "colors.bg",
    "#FFFFFF": "colors.card",
    "#1A1D26": "colors.text",
    "#2A2E3B": "colors.textSecondary",
    "#9AA0B4": "colors.textMuted",
    "#6B7185": "colors.textMuted",
    "#F2F3F7": "colors.divider",
    "#EDEEF3": "colors.divider",
    "#4F6BF0": "colors.accent",
    "#C4C8D4": "colors.textMuted",
}

base = os.path.dirname(os.path.abspath(__file__))

for f in files:
    path = os.path.join(base, f)
    if not os.path.exists(path):
        print(f"miss: {f}")
        continue
    with open(path, 'r', encoding='utf-8') as fh:
        content = fh.read()
    
    if "useTheme" in content and "from '@/lib/theme'" in content:
        print(f"skip: {f}")
        continue
    
    if "from '@/lib/theme'" not in content:
        content = "import { useTheme } from '@/lib/theme';\n" + content

    lines = content.split('\n')
    new_lines = []
    added_hook = False
    for i, line in enumerate(lines):
        new_lines.append(line)
        if not added_hook and re.match(r'^\s*(export\s+)?(default\s+)?function\s+\w+\s*\(', line):
            for j in range(i+1, min(i+6, len(lines))):
                stripped = lines[j].strip()
                if '{' in lines[j] and not stripped.startswith('//'):
                    indent = len(lines[j]) - len(lines[j].lstrip())
                    new_lines.append(' ' * (indent + 2) + "const { colors } = useTheme();")
                    added_hook = True
                    break
                elif stripped and not stripped.startswith('//'):
                    break

    if not added_hook:
        # Try arrow function: const X = () => { or export default function
        pass

    content = '\n'.join(new_lines)

    for hc, tr in color_map.items():
        content = content.replace(hc, tr)

    with open(path, 'w', encoding='utf-8') as fh:
        fh.write(content)
    print(f"done: {f}")

print("all done")
