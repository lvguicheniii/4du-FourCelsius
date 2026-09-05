import os, re

base = 'D:/chat0716/community-app/src/app'

files = {
    'account.tsx': "navigation.setOptions({ title: '账户与安全', headerStyle: { backgroundColor: colors.header }, headerTitleStyle: { fontSize: 17, fontWeight: '600', color: colors.text }, headerShadowVisible: false, headerTintColor: colors.accent });",
    'settings.tsx': "navigation.setOptions({ title: '设置', headerStyle: { backgroundColor: colors.header }, headerTitleStyle: { fontSize: 17, fontWeight: '600', color: colors.text }, headerShadowVisible: false, headerTintColor: colors.accent });",
    'edit-profile.tsx': "navigation.setOptions({ title: '编辑资料' });",
    'notifications.tsx': "navigation.setOptions({ title: '系统通知', headerStyle: { backgroundColor: colors.header }, headerTitleStyle: { fontSize: 17, fontWeight: '600', color: colors.text }, headerShadowVisible: false });",
    'user-list.tsx': "navigation.setOptions({ title: (typeof title === 'string' ? title : '') || '用户列表' });",
}

for fname, setopt in files.items():
    path = os.path.join(base, fname)
    if not os.path.exists(path): 
        # Check subdirs
        for root, dirs, files2 in os.walk(base):
            if fname in files2:
                path = os.path.join(root, fname)
                break
    if not os.path.exists(path):
        print(f'NOT FOUND: {fname}')
        continue
    
    with open(path, 'r', encoding='utf-8') as fh:
        content = fh.read()
    
    # Remove the Stack.Screen block
    # Patterns: <Stack.Screen ... /> (multiline)
    content = re.sub(r'\s*<Stack\.Screen\s+[^/]*/\s*>', '', content)
    content = re.sub(r'\s*<Stack\.Screen\s+options={{.*?}}\s*/\s*>', '', content, flags=re.DOTALL)
    content = re.sub(r'\s*<Stack\.Screen\s+options=\{({[^}]*})}\s*/\s*>', '', content, flags=re.DOTALL)
    
    # Remove unused Stack import if it was only used for Stack.Screen
    if '<Stack.' not in content:
        content = re.sub(r"import \{ Stack.*\} from 'expo-router';\n", '', content)
        # Add back what we need
        if 'useRouter' in content and 'import { useRouter' not in content:
            content = content.replace("import {", "import { Stack, ")
    
    # Add useLayoutEffect and navigation.setOptions
    # Add useLayoutEffect import
    has_effect = 'useLayoutEffect' in content
    if not has_effect:
        content = content.replace("import { useMemo, useState }", "import { useLayoutEffect, useMemo, useState }")
        content = content.replace("import { useState }", "import { useLayoutEffect, useState }")
        content = content.replace("import { useCallback, useState }", "import { useCallback, useLayoutEffect, useState }")
        content = content.replace("import { useEffect, useState }", "import { useLayoutEffect, useState }")
    
    # Add navigation = useNavigation() and useLayoutEffect
    if 'const navigation = useNavigation()' not in content:
        # Find the component function body opening
        content = content.replace(
            "import { useRouter } from 'expo-router';",
            "import { useRouter, useNavigation } from 'expo-router';"
        )
        # For user-list which has useLocalSearchParams
        content = content.replace(
            "import { useLocalSearchParams, useRouter } from 'expo-router';",
            "import { useLocalSearchParams, useRouter, useNavigation } from 'expo-router';"
        )
        
        # Add navigation ref after colors/state declarations
        content = re.sub(
            r'(const \{ colors \} = useTheme\(\);)',
            r'\1\n  const navigation = useNavigation();',
            content
        )
        content = re.sub(
            r'(export default function \w+\(\) \{\n)',
            r'\1  const navigation = useNavigation();\n',
            content
        )
    
    # Add useLayoutEffect with setOptions
    content = re.sub(
        r'(const navigation = useNavigation\(\);)\n',
        r'\1\n  useLayoutEffect(() => { ' + setopt + r' }, []);\n',
        content
    )
    
    # Clean up duplicate navigation declarations
    lines = content.split('\n')
    seen = set()
    out = []
    for line in lines:
        if 'const navigation = useNavigation()' in line:
            if 'nav_decl' in seen: continue
            seen.add('nav_decl')
        out.append(line)
    content = '\n'.join(out)
    
    with open(path, 'w', encoding='utf-8') as fh:
        fh.write(content)
    print(f'fixed: {fname}')

print('done')
