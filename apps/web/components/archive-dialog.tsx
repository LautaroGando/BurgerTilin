'use client';

import { useState } from 'react';
import { api } from '../lib/api';
import { ErrorBox, Modal } from './ui';

export default function ArchiveDialog({
  name,
  description,
  path,
  restore = false,
  remove = false,
  close,
  changed,
}: {
  name: string;
  description: string;
  path: string;
  restore?: boolean;
  remove?: boolean;
  close: () => void;
  changed: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const action = remove ? 'Eliminar definitivamente' : restore ? 'Restaurar' : 'Archivar';

  return (
    <Modal title={`${action} ${name}`} close={close} dismissible={!busy}>
      <p>{description}</p>
      <ErrorBox message={error} />
      <div className="modal-footer">
        <button type="button" className="secondary" onClick={close} disabled={busy}>
          Volver
        </button>
        <button
          type="button"
          className={restore ? 'primary' : 'danger'}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError('');
            try {
              if (remove) await api(path, undefined, 'DELETE');
              else await api(`${path}/archive`, { archived: !restore }, 'PATCH');
              changed();
              close();
            } catch (error) {
              setError((error as Error).message);
              setBusy(false);
            }
          }}
        >
          {busy ? 'Guardando…' : action}
        </button>
      </div>
    </Modal>
  );
}
