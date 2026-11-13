'use client';

import { useEffect, useRef, useState } from 'react';
import { Bell, Download } from 'lucide-react';
import { api } from '../lib/api';
import { registerAdminWorker } from '../lib/admin-push';
import { ErrorBox, Modal } from './ui';

export default function AdminMobile({
  close,
  install,
}: {
  close: () => void;
  install?: () => Promise<void>;
}) {
  const registration = useRef<ServiceWorkerRegistration>(null);
  const key = useRef<string>(null);
  const current = useRef<PushSubscription>(null);
  const [installed, setInstalled] = useState(false);
  const [ios, setIos] = useState(false);
  const [supported, setSupported] = useState(false);
  const [ready, setReady] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const display = window.matchMedia('(display-mode: standalone)');
    const browser = navigator as Navigator & { standalone?: boolean };
    const isIOS =
      /iPhone|iPad|iPod/.test(browser.userAgent) ||
      (browser.platform === 'MacIntel' && browser.maxTouchPoints > 1);
    setIos(isIOS);
    setInstalled(display.matches || Boolean(browser.standalone));
    const canPush = Boolean(
      'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window,
    );
    setSupported(canPush);
    if (!canPush || (isIOS && !display.matches && !browser.standalone)) return;
    let active = true;
    const prepare = async () => {
      const worker = await registerAdminWorker();
      const [readyWorker, result] = await Promise.all([
        worker.active ? worker : navigator.serviceWorker.ready,
        api('admin/push/key'),
      ]);
      if (!active) return;
      if (readyWorker.scope !== worker.scope)
        throw new Error('No se pudieron preparar los avisos. Recargá el admin.');
      registration.current = readyWorker;
      key.current = result.publicKey;
      current.current = await readyWorker.pushManager.getSubscription();
      const status =
        current.current && (await api('admin/push/status', { endpoint: current.current.endpoint }));
      if (!active) return;
      setEnabled(Boolean(status?.enabled) && Notification.permission === 'granted');
      setReady(true);
    };
    void prepare().catch((error) => {
      if (active) setError(error.message);
    });
    return () => {
      active = false;
    };
  }, []);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await action();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Volvé a intentar.');
    } finally {
      setBusy(false);
    }
  }

  function activate() {
    const worker = registration.current;
    const publicKey = key.current;
    if (!worker || !publicKey) return;
    void run(async () => {
      if (Notification.permission === 'denied') {
        throw new Error('Permití las notificaciones en los ajustes de la app o del navegador.');
      }
      const active =
        current.current ??
        (await worker.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: publicKey,
        }));
      await api('admin/push/device', active.toJSON());
      current.current = active;
      setEnabled(true);
      setMessage('Avisos de pedidos activados en este dispositivo.');
    });
  }

  function updateDevice(action: 'test' | 'remove') {
    void run(async () => {
      const subscription = await registration.current?.pushManager.getSubscription();
      if (!subscription) {
        current.current = null;
        setEnabled(false);
        return;
      }
      try {
        await api(`admin/push/${action}`, { endpoint: subscription.endpoint });
      } catch (error) {
        if ((error as { status?: number }).status === 404) {
          current.current = null;
          setEnabled(false);
          await subscription.unsubscribe().catch(() => {});
        }
        throw error;
      }
      if (action === 'test') {
        setMessage('Aviso enviado. Buscalo en tus notificaciones.');
      } else {
        current.current = null;
        setEnabled(false);
        await subscription.unsubscribe().catch(() => {});
        setMessage('Avisos desactivados en este dispositivo.');
      }
    });
  }

  return (
    <Modal title="App y avisos de pedidos" close={close}>
      {!installed && (
        <div className="notice">
          <strong>Instalá Tilín Admin</strong>
          <p>
            {ios
              ? 'En Safari, tocá Compartir → Agregar a pantalla de inicio. Después abrí Tilín Admin desde el ícono para activar los avisos. Requiere iOS 16.4 o posterior.'
              : 'En Chrome, abrí el menú ⋮ y elegí Instalar aplicación o Agregar a pantalla principal.'}
          </p>
          {!ios && install && (
            <button className="secondary" onClick={() => void run(install)}>
              <Download size={17} /> Instalar app
            </button>
          )}
        </div>
      )}
      {supported && (!ios || installed) && (
        <>
          <p>
            Recibí avisos de nuevos pedidos con la pantalla bloqueada. El celular usa su sonido de
            notificación. La melodía de Tilín se activa desde la pantalla de pedidos.
          </p>
          <div className="row">
            {enabled ? (
              <>
                <button className="primary" disabled={busy} onClick={() => updateDevice('test')}>
                  <Bell size={17} /> Probar aviso
                </button>
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => updateDevice('remove')}
                >
                  Desactivar avisos
                </button>
              </>
            ) : (
              <button className="primary" disabled={!ready || busy} onClick={activate}>
                <Bell size={17} /> Activar avisos
              </button>
            )}
          </div>
        </>
      )}
      {!supported && (!ios || installed) && (
        <p>Los avisos requieren un navegador compatible y una conexión segura.</p>
      )}
      {message && (
        <p role="status" className="success-message">
          {message}
        </p>
      )}
      <ErrorBox message={error} />
    </Modal>
  );
}
