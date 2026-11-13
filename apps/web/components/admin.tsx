'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import {
  LayoutGrid,
  ChefHat,
  Zap,
  ReceiptText,
  Package,
  Wallet,
  BarChart3,
  Settings,
  ExternalLink,
  Volume2,
  VolumeX,
  Pause,
  Play,
  Plus,
  Clock,
  ArrowRight,
  LogOut,
  Wifi,
  WifiOff,
  Flame,
  Search,
  Printer,
  Check,
  Users,
  Menu,
  RefreshCw,
  X,
} from 'lucide-react';
import { api, money, date, statusNames, channelLabel, Product, CartLine } from '../lib/api';
import { createOrderAlert } from '../lib/order-alert';
import { Brand, Modal, Empty, Loading, Field, ErrorBox } from './ui';
import { Customize, Checkout } from './shop';
import { ProductsView, InventoryView, SettingsView } from './management';
import { SalesView, CashView, CustomersView, ReportsView, OrderDetail } from './operations-ui';
const navigation = [
  { id: 'orders', label: 'Pedidos', icon: LayoutGrid },
  { id: 'kitchen', label: 'Modo cocina', icon: ChefHat },
  { id: 'pos', label: 'Venta rápida', icon: Zap },
  { id: 'sales', label: 'Ventas', icon: ReceiptText },
  { id: 'products', label: 'Productos', icon: Flame },
  { id: 'inventory', label: 'Inventario', icon: Package },
  { id: 'cash', label: 'Caja del turno', icon: Wallet },
  { id: 'customers', label: 'Clientes', icon: Users },
  { id: 'reports', label: 'Rendimiento', icon: BarChart3 },
  { id: 'settings', label: 'Configuración', icon: Settings },
];
const nextState: Record<string, string> = {
  NEW: 'ACCEPTED',
  ACCEPTED: 'PREPARING',
  PREPARING: 'READY',
  READY: 'DELIVERED',
  DISPATCHED: 'DELIVERED',
};
const nextLabel: Record<string, string> = {
  NEW: 'Aceptar pedido',
  ACCEPTED: 'Empezar a cocinar',
  PREPARING: 'Marcar listo',
  READY: 'Entregado',
  DISPATCHED: 'Entregado',
};
function Login({ done }: { done: (u: any) => void }) {
  const [email, setEmail] = useState(''),
    [password, setPassword] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <div className="login-screen">
      <div className="login-art">
        <Brand />
        <div>
          <span className="eyebrow">EL EQUIPO DETRÁS DE LA PLANCHA</span>
          <h1>
            Vos cociná.
            <br />
            Tilín organiza.
          </h1>
          <p>Pedidos, cocina y caja. Todo en su lugar.</p>
        </div>
        <small>BURGER TILÍN · ADMINISTRACIÓN</small>
      </div>
      <div className="login-form">
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              done(await api('auth/login', { email, password }));
            } catch (e: any) {
              setError(e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <span className="eyebrow orange">BUEN TURNO</span>
          <h2>Ingresá a tu local</h2>
          <p className="muted">Todo listo para empezar a trabajar.</p>
          <Field label="Correo">
            <input
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </Field>
          <Field label="Contraseña">
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </Field>
          <ErrorBox message={error} />
          <button className="primary full" disabled={busy}>
            {busy ? 'Ingresando…' : 'Entrar al administrador'}
            <ArrowRight size={18} />
          </button>
          <Link href="/menu" className="text-link">
            Ver tienda pública <ExternalLink size={14} />
          </Link>
        </form>
      </div>
    </div>
  );
}
export default function Admin() {
  const [user, setUser] = useState<any>(undefined),
    [view, setView] = useState('orders'),
    [orders, setOrders] = useState<any[]>([]),
    [operation, setOperation] = useState({ paused: true, delay: 30 }),
    [connected, setConnected] = useState(false),
    [sound, setSound] = useState(false),
    [activatingSound, setActivatingSound] = useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [filter, setFilter] = useState('ALL'),
    [detail, setDetail] = useState<any>(null),
    [tick, setTick] = useState(Date.now()),
    [mobile, setMobile] = useState(false);
  const audio = useRef<{ context: AudioContext; buffer: AudioBuffer } | null>(null);
  const playback = useRef<AudioBufferSourceNode | null>(null);
  useEffect(() => {
    api('auth/me')
      .then(setUser)
      .catch(() => setUser(null));
  }, []);
  const refresh = useCallback(async () => {
    try {
      const [o, s] = await Promise.all([api('admin/orders'), api('admin/operation')]);
      setOrders(o);
      setOperation(s);
      setError('');
      return true;
    } catch (e: any) {
      if (e.status === 401) setUser(null);
      setError(e.message);
      return false;
    }
  }, []);
  useEffect(() => {
    if (!user) return;
    if (user.pollOrders) {
      let active = true;
      let timer: ReturnType<typeof setTimeout>;
      const poll = async () => {
        const ok = await refresh();
        if (!active) return;
        setConnected(ok);
        setTick(Date.now());
        timer = setTimeout(poll, 4000);
      };
      void poll();
      return () => {
        active = false;
        clearTimeout(timer);
      };
    }
    refresh();
    const stream = new EventSource('/api/admin/events');
    stream.onopen = () => {
      setConnected(true);
      refresh();
    };
    stream.onmessage = (e) => {
      const data = JSON.parse(e.data);
      if (data.refresh) refresh();
    };
    stream.onerror = () => setConnected(false);
    const timer = setInterval(() => {
      setTick(Date.now());
      refresh();
    }, 15000);
    return () => {
      stream.close();
      clearInterval(timer);
    };
  }, [user, refresh]);
  const stopSound = useCallback(() => {
    const source = playback.current;
    if (!source) return;
    playback.current = null;
    source.stop();
    source.disconnect();
  }, []);
  const playSound = useCallback(
    (loop: boolean) => {
      const alert = audio.current;
      if (!alert || alert.context.state !== 'running') return;
      stopSound();
      const source = alert.context.createBufferSource();
      source.buffer = alert.buffer;
      source.loop = loop;
      source.connect(alert.context.destination);
      source.onended = () => {
        if (playback.current !== source) return;
        playback.current = null;
        source.disconnect();
      };
      source.start();
      playback.current = source;
    },
    [stopSound],
  );
  const newCount = orders.filter((order) => order.status === 'NEW').length;
  const shouldRing = Boolean(user && sound && newCount);
  useEffect(() => {
    if (!shouldRing) return;
    playSound(true);
    return stopSound;
  }, [shouldRing, playSound, stopSound]);
  useEffect(() => {
    if (!user) {
      stopSound();
      setSound(false);
      setOrders([]);
    }
  }, [user, stopSound]);
  useEffect(
    () => () => {
      stopSound();
      const alert = audio.current;
      audio.current = null;
      if (alert) void alert.context.close().catch(() => {});
    },
    [stopSound],
  );
  async function toggleSound() {
    if (sound) {
      stopSound();
      setSound(false);
      return;
    }
    setActivatingSound(true);
    try {
      if (!audio.current) {
        const context = new AudioContext();
        audio.current = { context, buffer: createOrderAlert(context) };
      }
      const { context } = audio.current;
      await context.resume();
      if (context.state !== 'running') throw new Error('El navegador suspendió el sonido.');
      if (!newCount) playSound(false);
      setSound(true);
    } catch {
      setError('No se pudo activar el sonido. Volvé a intentar desde este botón.');
    } finally {
      setActivatingSound(false);
    }
  }
  const run = async (fn: () => Promise<any>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      await refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  if (user === undefined) return <Loading />;
  if (!user)
    return (
      <Login
        done={(u) => {
          setUser(u);
          if (u.role === 'KITCHEN') setView('kitchen');
        }}
      />
    );
  const kitchen = view === 'kitchen' || user.role === 'KITCHEN';
  const shown = orders.filter((o) => filter === 'ALL' || o.status === filter);
  return (
    <div className={'admin-shell ' + (mobile ? 'nav-open' : '')}>
      <aside className="sidebar">
        <Link href="/admin">
          <Brand />
        </Link>
        <span className="workspace-label">TU LOCAL, EN ORDEN</span>
        <nav>
          {navigation
            .filter(
              (n) => user.role !== 'KITCHEN' || ['orders', 'kitchen', 'products'].includes(n.id),
            )
            .filter((n) => user.role === 'OWNER' || n.id !== 'settings')
            .map((n) => (
              <button
                key={n.id}
                className={view === n.id ? 'active' : ''}
                onClick={() => {
                  setView(n.id);
                  setMobile(false);
                  setError('');
                }}
              >
                <n.icon size={20} />
                {n.label}
                {n.id === 'orders' && newCount > 0 && <b className="nav-count">{newCount}</b>}
              </button>
            ))}
        </nav>
        <div className="sidebar-bottom">
          <Link href="/menu" target="_blank">
            <ExternalLink size={17} />
            Ver tienda pública
          </Link>
          <div className="user-panel">
            <span className="avatar">{user.email[0].toUpperCase()}</span>
            <div>
              <strong>
                {user.role === 'OWNER' ? 'Dueño' : user.role === 'KITCHEN' ? 'Cocina' : 'Caja'}
              </strong>
              <small>{user.email}</small>
            </div>
            <button
              title="Cerrar sesión"
              className="icon-btn"
              onClick={() =>
                run(async () => {
                  await api('auth/logout', {});
                  setUser(null);
                })
              }
            >
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>
      <div className="admin-body">
        <header className="admin-topbar">
          <button
            className="mobile-menu icon-btn"
            onClick={() => setMobile(!mobile)}
            aria-label="Menú"
          >
            <Menu />
          </button>
          <div className="breadcrumb">
            MI LOCAL <span>/</span> <b>{navigation.find((n) => n.id === view)?.label}</b>
          </div>
          <div className="row">
            <span className={'connection ' + (connected ? 'online' : 'offline')}>
              {connected ? <Wifi size={14} /> : <WifiOff size={14} />}
              {connected ? 'En vivo' : 'Reconectando…'}
            </span>
            <span className="top-date">
              {new Intl.DateTimeFormat('es-AR', {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
                timeZone: 'America/Argentina/Buenos_Aires',
              }).format(tick)}
            </span>
          </div>
        </header>
        <main className="admin-content" key={view}>
          <ErrorBox message={error} />
          {!connected && (
            <div className="notice">
              Conexión en tiempo real interrumpida. Recuperamos los pedidos al reconectar y
              consultamos cada 15 segundos.
            </div>
          )}
          {['orders', 'kitchen'].includes(view) ? (
            <>
              <div className="page-heading">
                <div>
                  <span className="eyebrow orange">A LA PLANCHA</span>
                  <h1>
                    {kitchen ? 'Modo cocina' : 'Pedidos del turno'}
                    <span className="heading-dot">.</span>
                  </h1>
                  <p className="muted">
                    {kitchen
                      ? 'Lo que hay que cocinar, sin distracciones.'
                      : 'Todo lo que está pasando, en un solo lugar.'}
                  </p>
                </div>
                <button
                  className={'secondary ' + (sound ? 'sound-on' : '')}
                  disabled={activatingSound}
                  onClick={toggleSound}
                >
                  {sound ? <Volume2 size={18} /> : <VolumeX size={18} />}{' '}
                  {sound ? 'Apagar sonido' : 'Activar y probar sonido'}
                </button>
              </div>
              <div className="shift-bar">
                <div className="row">
                  <span className={'status-pill ' + (operation.paused ? 'paused' : 'live')}>
                    <span className="live-dot" />
                    {operation.paused ? 'Pedidos pausados' : 'Tienda recibiendo pedidos'}
                  </span>
                  <button
                    className="text-action"
                    disabled={busy}
                    onClick={() =>
                      run(() => api('admin/operation', { paused: !operation.paused }, 'PATCH'))
                    }
                  >
                    {operation.paused ? <Play size={15} /> : <Pause size={15} />}{' '}
                    {operation.paused ? 'Reanudar' : 'Pausar'}
                  </button>
                </div>
                <label className="delay-control">
                  <Clock size={17} />
                  Demora estimada
                  <select
                    aria-label="Demora estimada"
                    value={operation.delay}
                    disabled={busy}
                    onChange={(e) =>
                      run(() => api('admin/operation', { delay: Number(e.target.value) }, 'PATCH'))
                    }
                  >
                    {[...new Set([15, 20, 30, 40, 45, 60, 90, operation.delay])]
                      .sort((a, b) => a - b)
                      .map((n) => (
                        <option key={n} value={n}>
                          {n} min
                        </option>
                      ))}
                  </select>
                </label>
              </div>
              {newCount > 0 && (
                <div className="new-order-banner">
                  <Flame size={20} />
                  <strong>Hay pedidos nuevos esperando tu atención.</strong>
                  <span>
                    {sound
                      ? 'La melodía sigue hasta atender todos los pedidos nuevos.'
                      : 'Activá el sonido para escuchar las alertas.'}
                  </span>
                </div>
              )}
              <div className="board-toolbar">
                <div className="order-tabs">
                  {[
                    ['ALL', 'Todos'],
                    ['NEW', 'Nuevos'],
                    ['ACCEPTED', 'Aceptados'],
                    ['PREPARING', 'En preparación'],
                    ['READY', 'Listos'],
                    ['DISPATCHED', 'En reparto'],
                  ].map(([id, label]) => (
                    <button
                      key={id}
                      className={filter === id ? 'active' : ''}
                      onClick={() => setFilter(id)}
                    >
                      {label}
                      <span>
                        {id === 'ALL'
                          ? orders.length
                          : orders.filter((o) => o.status === id).length}
                      </span>
                    </button>
                  ))}
                </div>
                {!kitchen && (
                  <button className="primary" onClick={() => setView('pos')}>
                    <Plus size={18} />
                    Nueva venta
                  </button>
                )}
              </div>
              {shown.length ? (
                <div className={'order-grid ' + (kitchen ? 'kitchen-grid' : '')}>
                  {shown.map((o) => {
                    const age = Math.floor((tick - new Date(o.createdAt).getTime()) / 60000);
                    const candidate =
                      o.status === 'READY' && o.fulfillment === 'DELIVERY'
                        ? 'DISPATCHED'
                        : nextState[o.status];
                    const next =
                      user.role === 'KITCHEN' &&
                      !['ACCEPTED', 'PREPARING', 'READY'].includes(candidate)
                        ? undefined
                        : candidate;
                    return (
                      <article className={'order-card status-' + o.status} key={o.id}>
                        <div className="order-card-head">
                          <strong>#{String(o.number).padStart(3, '0')}</strong>
                          <span className={'order-badge ' + o.status}>{statusNames[o.status]}</span>
                        </div>
                        <div className="order-meta">
                          <b>{o.fulfillment === 'DELIVERY' ? 'Delivery' : 'Retiro'}</b>
                          <span>{date(o.createdAt).split(',').pop()}</span>
                          <span className={age > o.estimatedMinutes ? 'late' : ''}>
                            <Clock size={13} />
                            {Math.max(0, age)} min
                          </span>
                        </div>
                        <div className="order-items">
                          {o.items.map((i: any, index: number) => (
                            <div key={index}>
                              <b className="quantity">{i.quantity}</b>
                              <div>
                                <strong>{i.name}</strong>
                                <ItemMods item={i} />
                                {i.components?.map((c: any, j: number) => (
                                  <div className="component-line" key={j}>
                                    ↳ {c.name}
                                    <ItemMods item={c} />
                                  </div>
                                ))}
                                {i.note && <p className="item-note">{i.note}</p>}
                              </div>
                            </div>
                          ))}
                        </div>
                        {o.notes && <div className="order-note">{o.notes}</div>}
                        {!kitchen && (
                          <div className="order-financial">
                            <span>
                              {o.customerName}
                              <small>
                                {channelLabel(o.channel)} · {statusNames[o.paymentStatus]}
                              </small>
                            </span>
                            <b>{money(o.total)}</b>
                          </div>
                        )}
                        <div className="order-actions">
                          {next && (
                            <button
                              className="primary full"
                              disabled={busy}
                              onClick={() =>
                                run(() =>
                                  api(`admin/orders/${o.id}/status`, { status: next }, 'PATCH'),
                                )
                              }
                            >
                              {o.status === 'READY' && o.fulfillment === 'DELIVERY'
                                ? 'Sale a reparto'
                                : nextLabel[o.status]}
                              <ArrowRight size={17} />
                            </button>
                          )}
                          <div className="row spread">
                            <span className="small muted">Est. {o.estimatedMinutes} min</span>
                            <button className="text-action" onClick={() => setDetail(o)}>
                              {kitchen ? 'Ver comanda' : 'Ver detalle'}
                              <ArrowRight size={14} />
                            </button>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <Empty
                  title={
                    filter === 'ALL' ? 'Todo tranquilo por acá' : 'No hay pedidos en este estado'
                  }
                  icon={<ChefHat size={36} />}
                >
                  <p>
                    Los nuevos pedidos aparecen automáticamente.
                    <br />
                    Vos concentrate en la plancha.
                  </p>
                  {!kitchen && (
                    <button className="secondary" onClick={() => setView('pos')}>
                      <Plus size={17} />
                      Registrar una venta
                    </button>
                  )}
                </Empty>
              )}
              <p className="board-footnote">
                <Volume2 size={14} />
                Las alertas funcionan con esta pantalla abierta y el sonido activado.
              </p>
            </>
          ) : view === 'pos' ? (
            <POS
              done={() => {
                setView('orders');
                refresh();
              }}
            />
          ) : view === 'products' ? (
            <ProductsView role={user.role} />
          ) : view === 'inventory' ? (
            <InventoryView role={user.role} />
          ) : view === 'settings' ? (
            <SettingsView />
          ) : view === 'sales' ? (
            <SalesView role={user.role} />
          ) : view === 'cash' ? (
            <CashView />
          ) : view === 'customers' ? (
            <CustomersView />
          ) : (
            <ReportsView />
          )}
        </main>
        <footer className="admin-footer">
          <span>
            BURGER TILÍN <b>·</b> HECHO PARA TU TURNO
          </span>
          <span>
            <span className="live-dot" />
            Los cambios se guardan en tu base de datos
          </span>
        </footer>
      </div>
      {detail && (
        <OrderDetail
          order={detail}
          kitchen={kitchen}
          close={() => setDetail(null)}
          changed={() => {
            setDetail(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}
export function ItemMods({ item }: { item: any }) {
  return (
    <>
      {item.variant && <small>{item.variant}</small>}
      {item.extras?.map((x: string, i: number) => (
        <small className="extra" key={'e' + i}>
          + {x}
        </small>
      ))}
      {item.remove?.map((x: string, i: number) => (
        <small className="remove" key={'r' + i}>
          SIN {x}
        </small>
      ))}
    </>
  );
}
function POS({ done }: { done: () => void }) {
  const [products, setProducts] = useState<Product[]>([]),
    [settings, setSettings] = useState<any>(),
    [query, setQuery] = useState(''),
    [channel, setChannel] = useState('WHATSAPP'),
    [cart, setCart] = useState<CartLine[]>([]),
    [discountInput, setDiscountInput] = useState(''),
    [selected, setSelected] = useState<Product | null>(null),
    [checkout, setCheckout] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    Promise.all([api('admin/products'), api('admin/settings')])
      .then(([p, s]) => {
        setProducts(p);
        setSettings(s);
      })
      .catch((e) => setError(e.message));
  }, []);
  const subtotal = cart.reduce((total, line) => total + line.displayPrice * line.quantity, 0);
  const discountText = discountInput.trim();
  const discount = Math.round(Number(discountText.replace(',', '.')) * 100);
  const maxDiscount = Math.min(subtotal, 100_000_000);
  let discountError = '';
  if (discountText && !/^\d+(?:[.,]\d{0,2})?$/.test(discountText)) {
    discountError = 'Ingresá un monto en pesos con hasta dos decimales.';
  } else if (discount > maxDiscount) {
    discountError = `El descuento máximo para esta venta es ${money(maxDiscount)}.`;
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow orange">SIN VUELTAS</span>
          <h1>Venta rápida.</h1>
          <p className="muted">Elegí, personalizá y registrá.</p>
        </div>
      </div>
      <ErrorBox message={error} />
      <div className="pos-layout">
        <section>
          <div className="row">
            <label className="search grow">
              <Search size={18} />
              <input
                placeholder="Buscar producto…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <select
              aria-label="Canal de venta"
              disabled={cart.length > 0}
              value={channel}
              onChange={(e) => setChannel(e.target.value)}
            >
              {settings?.channels.map((c: any) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="pos-products">
            {products
              .filter(
                (p) =>
                  p.published && p.available && p.name.toLowerCase().includes(query.toLowerCase()),
              )
              .sort((a, b) => Number(b.favorite) - Number(a.favorite))
              .map((p) => (
                <button key={p.id} onClick={() => setSelected(p)}>
                  {p.image && <img src={p.image} alt="" />}
                  <strong>{p.name}</strong>
                  <span>{money(p.config.channelPrices[channel] ?? p.price)}</span>
                  {p.favorite && <small>Favorito</small>}
                </button>
              ))}
          </div>
          {!products.some((p) => p.published) && (
            <Empty title="Primero publicá un producto">
              Completá los borradores desde Productos.
            </Empty>
          )}
        </section>
        <aside className="pos-cart">
          <h2>
            Venta actual <span>{cart.length}</span>
          </h2>
          {cart.length ? (
            cart.map((l, i) => (
              <div className="pos-line" key={i}>
                <span>
                  <b>
                    {l.quantity} × {l.label}
                  </b>
                  <small>{l.note}</small>
                </span>
                <b>{money(l.displayPrice * l.quantity)}</b>
                <button
                  className="icon-btn"
                  onClick={() => {
                    setCart(cart.filter((_, j) => i !== j));
                    if (cart.length === 1) setDiscountInput('');
                  }}
                  aria-label="Quitar"
                >
                  <X size={20} />
                </button>
              </div>
            ))
          ) : (
            <p className="muted">Agregá productos para empezar.</p>
          )}
          {cart.length > 0 && (
            <>
              <div className="pos-subtotal">
                <span>Subtotal</span>
                <b>{money(subtotal)}</b>
              </div>
              <Field label="Descuento (opcional)">
                <span className="money-input">
                  <span aria-hidden="true">$</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="0"
                    value={discountInput}
                    aria-invalid={Boolean(discountError)}
                    aria-describedby={discountError ? 'pos-discount-error' : undefined}
                    onChange={(e) => setDiscountInput(e.target.value)}
                  />
                </span>
              </Field>
              {discountError && (
                <p id="pos-discount-error" className="small late">
                  {discountError}
                </p>
              )}
            </>
          )}
          <div className="receipt-total" aria-live="polite">
            <span>Total a cobrar</span>
            <b>{discountError ? '—' : money(subtotal - discount)}</b>
          </div>
          <button
            disabled={!cart.length || !!discountError}
            className="primary full"
            onClick={() => setCheckout(true)}
          >
            Continuar <ArrowRight size={18} />
          </button>
          <p className="small muted">El cobro se verifica desde el detalle del pedido.</p>
        </aside>
      </div>
      {selected && (
        <Customize
          product={selected}
          products={products}
          channel={channel}
          close={() => setSelected(null)}
          add={(l) => setCart([...cart, l])}
        />
      )}
      {checkout && settings && (
        <Checkout
          manual
          cart={cart}
          settings={settings}
          channel={channel}
          discount={discount}
          close={() => setCheckout(false)}
          done={done}
        />
      )}
    </>
  );
}
