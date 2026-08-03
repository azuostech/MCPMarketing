declare const process: { env: Record<string, string | undefined> };

type QueryValue = string | number | boolean;

function getDatabaseConfig() {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be configured.');
  }
  return { url: url.replace(/\/$/, ''), serviceRoleKey };
}

async function request<T>(
  table: string,
  options: {
    method?: string;
    query?: Record<string, QueryValue>;
    body?: unknown;
    prefer?: string;
  } = {}
): Promise<T> {
  const { url, serviceRoleKey } = getDatabaseConfig();
  const target = new URL(`${url}/rest/v1/${table}`);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    target.searchParams.set(key, String(value));
  }
  const response = await fetch(target, {
    method: options.method ?? 'GET',
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
      ...(options.prefer ? { Prefer: options.prefer } : {})
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) })
  });
  if (!response.ok) {
    const body = (await response.text()).slice(0, 1200);
    throw new Error(`Database request failed (${response.status})${body ? `: ${body}` : ''}`);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export async function selectRows<T>(table: string, filters: Record<string, QueryValue>, select = '*') {
  const query: Record<string, QueryValue> = { select };
  for (const [key, value] of Object.entries(filters)) {
    query[key] = `eq.${value}`;
  }
  return request<T[]>(table, { query });
}

export async function selectOne<T>(table: string, filters: Record<string, QueryValue>, select = '*') {
  const rows = await selectRows<T>(table, filters, select);
  return rows[0];
}

export async function insertRow<T>(table: string, body: unknown) {
  const rows = await request<T[]>(table, {
    method: 'POST',
    body,
    prefer: 'return=representation'
  });
  return rows[0];
}

export async function upsertRow<T>(table: string, body: unknown, onConflict: string) {
  const rows = await request<T[]>(table, {
    method: 'POST',
    query: { on_conflict: onConflict },
    body,
    prefer: 'resolution=merge-duplicates,return=representation'
  });
  return rows[0];
}

export async function updateRows<T>(table: string, filters: Record<string, QueryValue>, body: unknown) {
  const query: Record<string, QueryValue> = {};
  for (const [key, value] of Object.entries(filters)) {
    query[key] = `eq.${value}`;
  }
  return request<T[]>(table, {
    method: 'PATCH',
    query,
    body,
    prefer: 'return=representation'
  });
}

export async function updateRowsWhere<T>(table: string, filters: Record<string, string>, body: unknown) {
  return request<T[]>(table, {
    method: 'PATCH',
    query: filters,
    body,
    prefer: 'return=representation'
  });
}

export async function deleteRows(table: string, filters: Record<string, QueryValue>) {
  const query: Record<string, QueryValue> = {};
  for (const [key, value] of Object.entries(filters)) {
    query[key] = `eq.${value}`;
  }
  await request<void>(table, { method: 'DELETE', query });
}
