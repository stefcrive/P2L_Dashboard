"""Stage only deployable application sources; exclude local records and secrets."""
from pathlib import Path
import shutil,json
root=Path(__file__).resolve().parents[1]
source=root/'frontend'
target=root/'outputs/vercel-deploy'
target.mkdir(parents=True,exist_ok=True)
for name in ('src','public','logos'):
 if (source/name).exists(): shutil.copytree(source/name,target/name,dirs_exist_ok=True)
for name in ('package.json','next.config.js','tailwind.config.ts','postcss.config.js','tsconfig.json','next-env.d.ts','vercel.json'):
 if (source/name).exists():shutil.copy2(source/name,target/name)
shutil.copytree(source/'.vercel',target/'.vercel',dirs_exist_ok=True,ignore=shutil.ignore_patterns('*.env*','output','cache'))
# There are no shared workspace imports; keep the deployable frontend independent.
config=(target/'next.config.js').read_text().replace("  transpilePackages: ['@irms/shared'],\n",'')
(target/'next.config.js').write_text(config)
(target/'.vercelignore').write_text('.env*\n.git\nnode_modules\n.next\n.agents\n')
print(target)
