const API_BASE = import.meta.env.VITE_API_URL || '';

export function api(path: string): string {
  return `${API_BASE}/api${path}`;
}

export { API_BASE };
