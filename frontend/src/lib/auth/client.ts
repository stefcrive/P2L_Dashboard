const unavailable = 'The sign-in service is temporarily unavailable. Try again.';

export async function readSignInResponse(response: Response): Promise<void> {
  const result: unknown = await response.json().catch(() => null);
  if (!result || typeof result !== 'object' || Array.isArray(result) || response.status >= 500) {
    throw new Error(unavailable);
  }
  const payload = result as Record<string, unknown>;
  if (!response.ok) {
    const message = [payload.detail, payload.error].find(value => typeof value === 'string' && value.trim());
    throw new Error(typeof message === 'string' ? message : 'Unable to sign in. Check your username and password.');
  }
  // A successful HTTP response alone is not proof of a completed sign-in.
  if (!payload.user || typeof payload.user !== 'object' || !('id' in payload.user) || typeof payload.user.id !== 'string' || !payload.user.id) {
    throw new Error(unavailable);
  }
}
