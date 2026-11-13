'use client';
import { X, LoaderCircle, Flame } from 'lucide-react';
import { useEffect, useId, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { createPortal } from 'react-dom';
export function Brand({ admin = false }: { admin?: boolean }) {
  return (
    <span className={admin ? 'brand admin-brand' : 'brand'}>
      <span className="brand-icon">
        <img className="brand-logo" src="/assets/brand-mark.webp" alt="" />
      </span>
      <span>
        BURGER{' '}
        <strong>
          TILÍN<span className="brand-dot">.</span>
        </strong>
      </span>
    </span>
  );
}
export function Modal({
  title,
  children,
  close,
  wide = false,
  dismissible = true,
  dismissRef,
}: {
  title: string;
  children: React.ReactNode;
  close: () => void;
  wide?: boolean;
  dismissible?: boolean;
  dismissRef?: Ref<() => void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [mounted, setMounted] = useState(false);
  const [closing, setClosing] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
    return () => {
      if (timer.current !== null) clearTimeout(timer.current);
      element?.close();
    };
  }, [mounted]);
  function dismiss() {
    if (!dismissible || timer.current !== null) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      close();
      return;
    }
    setClosing(true);
    timer.current = setTimeout(() => {
      timer.current = null;
      close();
      setClosing(false);
    }, 180);
  }
  useImperativeHandle(dismissRef, () => dismiss);
  return (
    mounted &&
    createPortal(
      <dialog
        ref={dialog}
        className="modal-backdrop"
        aria-labelledby={titleId}
        data-closing={closing || undefined}
        onClick={(e) => {
          if (e.target === e.currentTarget) dismiss();
        }}
        onCancel={(e) => {
          e.preventDefault();
          e.stopPropagation();
          dismiss();
        }}
      >
        <section className={'modal ' + (wide ? 'wide' : '')} inert={closing}>
          <header>
            <h2 id={titleId}>{title}</h2>
            <button
              type="button"
              className="icon-btn"
              onClick={dismiss}
              aria-label="Cerrar"
              disabled={!dismissible}
            >
              <X size={22} />
            </button>
          </header>
          {children}
        </section>
      </dialog>,
      document.body,
    )
  );
}
export function Toggle(props: Omit<React.ComponentPropsWithoutRef<'input'>, 'type' | 'role'>) {
  return <input {...props} type="checkbox" role="switch" className="switch" />;
}
export function Empty({
  title,
  children,
  icon,
}: {
  title: string;
  children?: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon || <Flame size={32} />}</div>
      <h3>{title}</h3>
      <div className="muted">{children}</div>
    </div>
  );
}
export function Loading() {
  return (
    <div className="loading">
      <LoaderCircle className="spin" /> Conectando con Burger Tilín…
    </div>
  );
}
export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
export function ErrorBox({ message }: { message: string }) {
  return message ? (
    <div className="error" role="alert">
      {message}
    </div>
  ) : null;
}
