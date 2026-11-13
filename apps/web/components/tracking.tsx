'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Check, Clock, ArrowUpRight } from 'lucide-react';
import { api, money, statusNames, date } from '../lib/api';
import { Brand, ErrorBox, Loading } from './ui';
export default function Tracking({ token }: { token: string }) {
  const [order, setOrder] = useState<any>(),
    [settings, setSettings] = useState<any>(),
    [error, setError] = useState(''),
    [paymentError, setPaymentError] = useState(''),
    [paying, setPaying] = useState(false),
    [returnedFromPayment, setReturnedFromPayment] = useState(false);
  const pendingOnline = order?.onlinePayment && order.paymentStatus === 'PENDING';
  const waitingForPayment = pendingOnline && order.status === 'NEW';
  async function pay() {
    setPaying(true);
    setPaymentError('');
    try {
      const { checkoutUrl } = await api(`tracking/${token}/mercado-pago`, {});
      window.location.assign(checkoutUrl);
    } catch (e) {
      setPaymentError((e as Error).message);
      setPaying(false);
    }
  }
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('mp') === 'retorno') {
      setReturnedFromPayment(true);
      window.history.replaceState(window.history.state, '', window.location.pathname);
    }
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    let checkPayment = false;
    const path = `tracking/${token}`;
    const load = async () => {
      try {
        const verify = () => api(`${path}/mercado-pago/verificar`, {});
        let current = await (checkPayment ? verify().catch(() => api(path)) : api(path));
        const pending =
          current.onlineCheckoutStarted &&
          current.status === 'NEW' &&
          current.paymentStatus === 'PENDING';
        if (pending && !checkPayment) current = await verify().catch(() => current);
        checkPayment = pending && current.paymentStatus === 'PENDING';
        if (active) {
          setOrder(current);
          setError('');
        }
      } catch (e) {
        if (active) setError((e as Error).message);
      } finally {
        if (active) timer = setTimeout(load, 7000);
      }
    };
    void load();
    api('catalog')
      .then((d) => {
        if (active) setSettings(d.settings);
      })
      .catch(() => {});
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [token]);
  return (
    <main className="tracking">
      <Link href="/menu">
        <Brand />
      </Link>
      <ErrorBox message={error} />
      {order ? (
        <>
          <div className="success-icon">
            {waitingForPayment ? <Clock size={32} /> : <Check size={32} />}
          </div>
          <span className="eyebrow orange">
            {waitingForPayment ? 'PAGO PENDIENTE' : 'GUARDADO CORRECTAMENTE'}
          </span>
          <h1>Pedido #{order.number}</h1>
          <p>Conservá este enlace privado para ver las novedades.</p>
          <div className="tracking-status">
            <span className="live-dot" />
            {waitingForPayment ? 'Esperando el pago' : statusNames[order.status]}
          </div>
          {!(pendingOnline || ['CANCELLED', 'REJECTED'].includes(order.status)) && (
            <div className="muted">
              <Clock size={16} /> {order.estimatedMinutes} min estimados · {date(order.createdAt)}
            </div>
          )}
          <div className="receipt">
            {order.items.map((i: any, k: number) => (
              <div key={k}>
                <span>
                  {i.quantity} × {i.name}
                </span>
              </div>
            ))}
            <div className="receipt-total">
              <span>Total</span>
              <b>{money(order.total)}</b>
            </div>
            <div>
              <span>Pago</span>
              <b>
                {order.onlinePayment && order.paymentStatus === 'CANCELLED'
                  ? 'Vencido o cancelado'
                  : statusNames[order.paymentStatus]}
              </b>
            </div>
          </div>
          {waitingForPayment && (
            <>
              <p className="notice">
                {returnedFromPayment
                  ? 'Estamos verificando el cobro con Mercado Pago. Si el pago fue rechazado, podés reintentar.'
                  : !order.onlineCheckoutStarted
                    ? order.canPayOnline
                      ? 'No se pudo abrir Mercado Pago. Podés reintentar el pago acá.'
                      : 'Venció el tiempo para pagar. Volvé al menú para hacer otro pedido.'
                    : 'Si ya pagaste, esperá la confirmación de Mercado Pago.'}
              </p>
              <ErrorBox message={paymentError} />
              {order.canPayOnline && (
                <button className="primary full" disabled={paying} onClick={pay}>
                  {paying ? 'Abriendo Mercado Pago…' : 'Continuar a Mercado Pago'}{' '}
                  <ArrowUpRight size={19} />
                </button>
              )}
            </>
          )}
          {settings?.whatsapp && (
            <a
              className="primary full"
              href={`https://wa.me/${settings.whatsapp}?text=${encodeURIComponent(`Hola, consulto por mi pedido #${order.number}`)}`}
              target="_blank"
              rel="noreferrer"
            >
              Consultar por WhatsApp <ArrowUpRight size={18} />
            </a>
          )}
          <Link className="text-link" href="/menu">
            Volver al menú
          </Link>
        </>
      ) : (
        <Loading />
      )}
    </main>
  );
}
