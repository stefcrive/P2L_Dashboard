import Image from 'next/image';

export function P2LLogo() {
  return <Image src="/brand/p2l-logo.png" alt="P2L" width={52} height={36} priority unoptimized className="h-9 w-[52px] shrink-0 object-contain" />;
}

export function EvoStudioBrand({ compact = false }: { compact?: boolean }) {
  return (
    <a href="https://evostudio.com.br" target="_blank" rel="noopener noreferrer" aria-label="EvoStudio — opens in a new tab" className="flex shrink-0 items-center gap-2 rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
      <Image src="/brand/evostudio-logo.svg" alt="" width={32} height={29} unoptimized className="h-7 w-8 object-contain" />
      <span className={compact ? 'hidden leading-tight xl:block' : 'leading-tight'}>
        <span className="block text-[10px] text-muted-foreground">Powered by</span>
        <span className="block text-xs font-semibold text-foreground">EvoStudio</span>
      </span>
    </a>
  );
}
