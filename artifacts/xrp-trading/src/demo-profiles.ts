export type DemoProfile = { id: string; name: string };

const LIST_KEY = 'xrpq-demo-profiles';
const CURRENT_KEY = 'xrpq-demo-profile';
export const DEFAULT_PROFILE: DemoProfile = { id: 'local-demo', name: 'demo' };
export const LOGIN_ID_PATTERN = /^[a-z0-9][a-z0-9-]{2,23}$/;

export function listProfiles(): DemoProfile[] {
  let saved: DemoProfile[] = [];
  try {
    const parsed = JSON.parse(localStorage.getItem(LIST_KEY) ?? '[]') as unknown;
    if (Array.isArray(parsed)) {
      saved = parsed.filter((item): item is DemoProfile => typeof item?.id === 'string' && typeof item?.name === 'string' && /^local-[a-z0-9-]{3,40}$/.test(item.id));
    }
  } catch {
    saved = [];
  }
  saved = saved.map(item => item.id === DEFAULT_PROFILE.id ? DEFAULT_PROFILE : item);
  return saved.some(item => item.id === DEFAULT_PROFILE.id) ? saved : [...saved, DEFAULT_PROFILE];
}

function storeProfiles(profiles: DemoProfile[]) {
  localStorage.setItem(LIST_KEY, JSON.stringify(profiles.slice(0, 8)));
}

export function normalizeLoginId(raw: string): string {
  return raw.trim().toLowerCase().replace(/[\s_.]+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 24);
}

export function profileFromId(id: string): DemoProfile {
  return listProfiles().find(item => item.id === id) ?? { id, name: id.replace(/^local-/, '') };
}

export function loginWithId(raw: string): DemoProfile | null {
  const login = normalizeLoginId(raw);
  if (!LOGIN_ID_PATTERN.test(login)) return null;
  const profile = profileFromId(`local-${login}`);
  storeProfiles([profile, ...listProfiles().filter(item => item.id !== profile.id)]);
  return profile;
}

export function removeProfile(id: string) {
  if (id === DEFAULT_PROFILE.id) return;
  storeProfiles(listProfiles().filter(item => item.id !== id));
}

export function currentProfileId(): string | null {
  return sessionStorage.getItem(CURRENT_KEY);
}

export function setCurrentProfile(id: string | null) {
  if (id) sessionStorage.setItem(CURRENT_KEY, id);
  else sessionStorage.removeItem(CURRENT_KEY);
}

export function installDemoFetch(basePath: string) {
  const original = window.fetch.bind(window);
  const prefix = `${basePath}/api`;
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const id = currentProfileId();
    if (!id) return original(input, init);
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw, window.location.href);
    if (url.origin !== window.location.origin || !url.pathname.startsWith(prefix)) return original(input, init);
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    headers.set('x-demo-user', id);
    return original(input, { ...init, headers });
  };
}
