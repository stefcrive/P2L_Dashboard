'use client';
import { useState, type FormEvent } from 'react';
import { EvoStudioBrand, P2LLogo } from '@/components/layout/brand-logos';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export default function Login() {
  const [error,setError]=useState(''); const [busy,setBusy]=useState(false);
  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(''); const form=new FormData(event.currentTarget);
    try {
      const response=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:form.get('username'),password:form.get('password')})});
      const result=await response.json(); if(!response.ok) throw new Error(result.detail??result.error??'Unable to sign in.');
      const next=new URLSearchParams(window.location.search).get('next'); window.location.assign(next?.startsWith('/') && !next.startsWith('//')?next:'/');
    } catch(error) { setError(error instanceof Error?error.message:'Unable to sign in.'); setBusy(false); }
  }
  return <main className="grid min-h-screen place-items-center bg-background p-4"><section className="w-full max-w-md rounded-lg border border-t-[3px] border-t-primary bg-card p-7" aria-labelledby="login-title"><div className="mb-7 flex items-center gap-2 text-primary"><P2LLogo /><span className="text-sm font-semibold">P2L · Laboratory workspace</span></div><h1 id="login-title" className="text-[22px] font-semibold">Sign in to your workspace</h1><p className="mb-6 mt-2 text-sm leading-6 text-muted-foreground">Use your IRMS Metrology Station account to access laboratory operations.</p><form onSubmit={submit} className="grid gap-4"><label className="grid gap-2 text-sm font-medium">Username<Input name="username" autoComplete="username" autoCapitalize="none" required maxLength={80}/></label><label className="grid gap-2 text-sm font-medium">Password<Input name="password" type="password" autoComplete="current-password" required maxLength={256}/></label>{error&&<p role="alert" className="text-sm text-destructive">{error}</p>}<Button disabled={busy} type="submit">{busy?'Signing in…':'Sign in'}</Button></form><div className="mt-6 flex justify-center border-t pt-5"><EvoStudioBrand /></div></section></main>;
}
