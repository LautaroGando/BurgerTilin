'use client';
import { useState, useEffect } from 'react';
import { api, date } from '../lib/api';
import { Field, ErrorBox } from './ui';
export function AccessPanel() {
  const [users, setUsers] = useState<any[]>([]),
    [error, setError] = useState(''),
    [current, setCurrent] = useState(''),
    [password, setPassword] = useState(''),
    [reset, setReset] = useState<any>(),
    [busy, setBusy] = useState(false);
  const load = () =>
    api('admin/users')
      .then(setUsers)
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);
  async function update(id: string, data: any) {
    setBusy(true);
    setError('');
    try {
      await api('admin/users/' + id, data, 'PATCH');
      load();
      setReset(undefined);
      setPassword('');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section>
      <h2>Accesos existentes</h2>
      <p className="muted small">
        Cambiar permisos o contraseña cierra las sesiones de ese usuario. Tu propio permiso solo
        puede modificarlo otro dueño.
      </p>
      {users.map((u) => (
        <div className="editor-block" key={u.id}>
          <b>{u.email}</b>
          <div className="row">
            <select
              aria-label={`Permiso de ${u.email}`}
              disabled={busy}
              value={u.role}
              onChange={(e) => update(u.id, { role: e.target.value })}
            >
              {['OWNER', 'CASHIER', 'KITCHEN'].map((r, i) => (
                <option key={r} value={r}>
                  {['Dueño', 'Caja', 'Cocina'][i]}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={busy}
              className="secondary"
              onClick={() => update(u.id, { active: !u.active })}
            >
              {u.active ? 'Desactivar' : 'Reactivar'}
            </button>
            <button
              type="button"
              className="text-action"
              onClick={() => {
                setReset(u);
                setPassword('');
              }}
            >
              Restablecer contraseña
            </button>
          </div>
        </div>
      ))}
      {reset && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            update(reset.id, { password });
          }}
        >
          <Field label={`Nueva contraseña de ${reset.email}`}>
            <input
              autoComplete="new-password"
              type="password"
              minLength={12}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <button disabled={busy} className="primary">
            Restablecer y cerrar sesiones
          </button>
          <button type="button" className="secondary" onClick={() => setReset(undefined)}>
            Cancelar
          </button>
        </form>
      )}
      <details>
        <summary>Cambiar mi contraseña</summary>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await api('auth/password', { current, password });
              window.location.reload();
            } catch (e: any) {
              setError(e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label="Contraseña actual">
            <input
              autoComplete="current-password"
              type="password"
              required
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
          </Field>
          <Field label="Contraseña nueva">
            <input
              autoComplete="new-password"
              type="password"
              minLength={12}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <button disabled={busy} className="primary">
            Cambiar y volver a ingresar
          </button>
        </form>
      </details>
      <ErrorBox message={error} />
      <hr />
    </section>
  );
}
export function AuditPanel() {
  const [rows, setRows] = useState<any[]>([]),
    [error, setError] = useState('');
  useEffect(() => {
    api('admin/audit')
      .then(setRows)
      .catch((e) => setError(e.message));
  }, []);
  return (
    <section>
      <h2>Historial de cambios sensibles</h2>
      <p className="muted small">Últimos 100 cambios. Los registros no se pueden editar.</p>
      <ErrorBox message={error} />
      {rows.map((r) => (
        <details className="editor-block" key={r.id}>
          <summary>
            {date(r.createdAt)} · {r.action}
          </summary>
          <p>
            Responsable: {r.actor} · Registro: {r.entity}
          </p>
          <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
            {JSON.stringify(r.data, null, 2)}
          </pre>
        </details>
      ))}
    </section>
  );
}
