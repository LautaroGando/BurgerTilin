'use client';
import { useState, useEffect, useRef } from 'react';
import {
  ShoppingBag,
  ArrowUpRight,
  Plus,
  Minus,
  Clock,
  MapPin,
  ArrowRight,
  Search,
  Check,
  Flame,
  Store,
  Truck,
  Banknote,
  Landmark,
  CreditCard,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { api, money, Product, CartLine } from '../lib/api';
import { Brand, Modal, Empty, Field, ErrorBox, Loading, Toggle } from './ui';
import DeliveryMap from './delivery-map';

const menuCategories = ['Promociones', 'Combos', 'Hamburguesas', 'Papas', 'Bebidas'];
const menuCategoryRank = (category: string) => {
  const index = menuCategories.indexOf(category);
  return index === -1 ? menuCategories.length : index;
};

const blankChoice = (id: string) => ({ productId: id, extras: [], remove: [] });
const paymentIcons = new Map([
  ['cash', Banknote],
  ['transfer', Landmark],
]);
const toggleChoice = (ids: string[], id: string) =>
  ids.includes(id) ? ids.filter((selected) => selected !== id) : [...ids, id];
const extraLimit = 20;

function ExtrasEditor({
  extras,
  selected,
  onChange,
  title = 'Sumale un extra',
}: {
  extras: { id: string; name: string; price: number }[];
  selected: string[];
  onChange: (ids: string[]) => void;
  title?: string;
}) {
  if (!extras.length) return null;
  return (
    <fieldset>
      <legend>{title}</legend>
      {extras.map((extra) => {
        const quantity = selected.filter((id) => id === extra.id).length;
        return (
          <div className="extra-option" key={extra.id}>
            <span>
              <b>{extra.name}</b>
              <small>+{money(extra.price)} por unidad</small>
            </span>
            <div className="stepper" role="group" aria-label={`Cantidad de ${extra.name}`}>
              <button
                type="button"
                disabled={quantity === 0}
                aria-label={`Quitar una unidad de ${extra.name}`}
                onClick={() => {
                  const index = selected.indexOf(extra.id);
                  onChange(selected.filter((_, i) => i !== index));
                }}
              >
                <Minus size={16} aria-hidden="true" />
              </button>
              <b aria-live="polite">{quantity}</b>
              <button
                type="button"
                disabled={selected.length >= extraLimit}
                aria-label={`Sumar una unidad de ${extra.name}`}
                onClick={() => onChange([...selected, extra.id])}
              >
                <Plus size={16} aria-hidden="true" />
              </button>
            </div>
          </div>
        );
      })}
    </fieldset>
  );
}

function RemovalsEditor({
  recipe,
  selected,
  onChange,
}: {
  recipe: { ingredientId: string; name?: string; removable: boolean }[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const removable = recipe.filter((ingredient) => ingredient.removable);
  if (!removable.length) return null;
  return (
    <fieldset>
      <legend>Quitar ingredientes</legend>
      {removable.map((ingredient) => (
        <label className="check-row" key={ingredient.ingredientId}>
          <Toggle
            checked={selected.includes(ingredient.ingredientId)}
            onChange={() => onChange(toggleChoice(selected, ingredient.ingredientId))}
          />
          Sin {ingredient.name || ingredient.ingredientId}
        </label>
      ))}
    </fieldset>
  );
}

export function ChoiceEditor({
  product,
  value,
  onChange,
}: {
  product: Product;
  value: any;
  onChange: (v: any) => void;
}) {
  const c = product.config;
  const recipe = value.variantId
    ? c.variants.find((v: any) => v.id === value.variantId)?.recipe || []
    : c.recipe;
  return (
    <div className="choice-editor">
      {c.variants.length > 0 && (
        <Field label="Variante">
          <select
            value={value.variantId || ''}
            onChange={(e) =>
              onChange({ ...value, variantId: e.target.value || undefined, remove: [] })
            }
          >
            <option value="">Original</option>
            {c.variants.map((v: any) => (
              <option key={v.id} value={v.id}>
                {v.name} · +{money(v.delta)}
              </option>
            ))}
          </select>
        </Field>
      )}
      <ExtrasEditor
        extras={c.extras}
        selected={value.extras}
        onChange={(extras) => onChange({ ...value, extras })}
      />
      <RemovalsEditor
        recipe={recipe}
        selected={value.remove}
        onChange={(remove) => onChange({ ...value, remove })}
      />
    </div>
  );
}
export function Customize({
  product,
  products,
  close,
  add,
  channel = 'WEB',
}: {
  product: Product;
  products: Product[];
  close: () => void;
  add: (l: CartLine) => void;
  channel?: string;
}) {
  const dismiss = useRef<() => void>(null);
  const c = product.config;
  const [value, setValue] = useState<any>({
    ...blankChoice(product.id),
    components: c.slots.map((s: any) => ({
      slotId: s.id,
      choices: Array.from({ length: s.quantity }, () => blankChoice(s.choices[0].productId)),
    })),
    quantity: 1,
    note: '',
  });
  const extra = (p: Product, v: { variantId?: string; extras: string[] }) => {
    const config = p.config;
    return (
      (config.variants.find((x: any) => x.id === v.variantId)?.delta || 0) +
      v.extras.reduce(
        (sum, id) => sum + (config.extras.find((x: any) => x.id === id)?.price ?? 0),
        0,
      )
    );
  };
  let price = (c.channelPrices?.[channel] ?? product.price ?? 0) + extra(product, value);
  if (c.slots.length) {
    for (const s of c.slots) {
      for (const choice of value.components.find((x: any) => x.slotId === s.id).choices) {
        const p = products.find((p) => p.id === choice.productId);
        price +=
          (s.choices.find((x: any) => x.productId === choice.productId)?.delta || 0) +
          (p ? extra(p, choice) : 0);
      }
    }
  }
  return (
    <Modal title={product.name} close={close} dismissRef={dismiss}>
      {product.image && <img className="custom-image" src={product.image} alt={product.name} />}
      <p className="muted">{product.description}</p>
      {c.slots.length > 0 && (
        <>
          <ExtrasEditor
            title="Extras del combo"
            extras={c.extras}
            selected={value.extras}
            onChange={(extras) => setValue({ ...value, extras })}
          />
          <RemovalsEditor
            recipe={c.recipe}
            selected={value.remove}
            onChange={(remove) => setValue({ ...value, remove })}
          />
        </>
      )}
      {c.slots.length ? (
        c.slots.map((s: any, si: number) => (
          <section className="combo-slot" key={s.id}>
            <h3>{s.name}</h3>
            {value.components[si].choices.map((v: any, index: number) => {
              const chosen = products.find((p) => p.id === v.productId);
              const update = (newChoice: any) =>
                setValue({
                  ...value,
                  components: value.components.map((slot: any, i: number) =>
                    i !== si
                      ? slot
                      : {
                          ...slot,
                          choices: slot.choices.map((ch: any, j: number) =>
                            j === index ? newChoice : ch,
                          ),
                        },
                  ),
                });
              return (
                <div key={index} className="component-choice">
                  <Field label={`${s.name} ${index + 1}`}>
                    <select
                      value={v.productId}
                      onChange={(e) => update(blankChoice(e.target.value))}
                    >
                      {s.choices.map((ch: any) => (
                        <option key={ch.productId} value={ch.productId}>
                          {products.find((p) => p.id === ch.productId)?.name ||
                            'Producto no disponible'}{' '}
                          · +{money(ch.delta)}
                        </option>
                      ))}
                    </select>
                  </Field>
                  {chosen && <ChoiceEditor product={chosen} value={v} onChange={update} />}
                </div>
              );
            })}
          </section>
        ))
      ) : (
        <ChoiceEditor product={product} value={value} onChange={setValue} />
      )}
      <Field label="Nota para cocina (opcional)">
        <input
          placeholder="Las modificaciones se eligen arriba"
          maxLength={300}
          value={value.note}
          onChange={(e) => setValue({ ...value, note: e.target.value })}
        />
      </Field>
      <div className="modal-footer">
        <div className="stepper">
          <button
            disabled={value.quantity === 1}
            onClick={() => setValue({ ...value, quantity: value.quantity - 1 })}
            aria-label="Quitar una unidad"
          >
            <Minus size={18} />
          </button>
          <b>{value.quantity}</b>
          <button
            disabled={value.quantity === 30}
            onClick={() => setValue({ ...value, quantity: value.quantity + 1 })}
            aria-label="Agregar una unidad"
          >
            <Plus size={18} />
          </button>
        </div>
        <button
          className="primary"
          onClick={() => {
            add({ ...value, label: product.name, displayPrice: price });
            dismiss.current?.();
          }}
        >
          Agregar · {money(price * value.quantity)}
        </button>
      </div>
    </Modal>
  );
}
export function Checkout({
  cart,
  settings,
  manual = false,
  close,
  done,
  channel = 'WEB',
  discount = 0,
}: {
  cart: CartLine[];
  settings: any;
  manual?: boolean;
  close: () => void;
  done: (result: any) => void;
  channel?: string;
  discount?: number;
}) {
  const quickAppsSale = manual && channel === 'APPS';
  const methods = (settings.methods as { id: string; name: string; enabled?: boolean }[]).filter(
    (method) =>
      method.enabled !== false && (!quickAppsSale || ['cash', 'transfer'].includes(method.id)),
  );
  const [form, setForm] = useState({
    name: manual && !quickAppsSale ? 'Cliente' : '',
    phone: '',
    address: '',
    zone: settings.zones[0]?.id || '',
    fulfillment: 'PICKUP',
    notes: '',
    method: methods[0]?.id || '',
  });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const endpoint = quickAppsSale ? 'admin/orders/quick-apps-sale' : manual ? 'admin/orders' : 'orders';
  const storageKey = quickAppsSale ? 'tilin-quick-apps-sale-key' : 'tilin-checkout-key';
  const [key] = useState(() => {
    const saved = sessionStorage.getItem(storageKey);
    if (saved) return saved;
    const id = crypto.randomUUID();
    sessionStorage.setItem(storageKey, id);
    return id;
  });
  const subtotal = cart.reduce((a, l) => a + l.displayPrice * l.quantity, 0);
  const zone = settings.zones.find((z: any) => z.id === form.zone);
  const shipping = form.fulfillment === 'DELIVERY' ? zone?.fee || 0 : 0;
  const appliedDiscount = manual ? discount : 0;
  const total = subtotal + shipping - appliedDiscount;
  const change = (name: string, value: string) => setForm((f) => ({ ...f, [name]: value }));
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await api(endpoint, {
        ...(quickAppsSale ? { name: form.name, method: form.method } : { ...form, channel }),
        key,
        discount: appliedDiscount,
        expectedTotal: total,
        items: cart.map(({ label, displayPrice, ...l }) => l),
      });
      sessionStorage.removeItem(storageKey);
      done(result);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={manual ? 'Confirmar venta' : 'Ya casi está tu pedido'} close={close}>
      <form onSubmit={submit}>
        {!quickAppsSale && (
          <div className="segmented">
            <button
              type="button"
              className={form.fulfillment === 'PICKUP' ? 'selected' : ''}
              onClick={() => change('fulfillment', 'PICKUP')}
            >
              <Store size={18} />
              Retiro
            </button>
            <button
              type="button"
              className={form.fulfillment === 'DELIVERY' ? 'selected' : ''}
              onClick={() => change('fulfillment', 'DELIVERY')}
            >
              <Truck size={18} />
              Delivery
            </button>
          </div>
        )}
        <Field label={quickAppsSale ? 'Nombre (opcional)' : 'Nombre'}>
          <input
            autoComplete="name"
            required={!quickAppsSale}
            maxLength={100}
            value={form.name}
            onChange={(e) => change('name', e.target.value)}
          />
        </Field>
        {!quickAppsSale && (
          <Field
            label={`Teléfono con código de país y área${manual ? ' (opcional para retiro)' : ''}`}
          >
            <input
              type="tel"
              autoComplete="tel"
              required={!manual || form.fulfillment === 'DELIVERY'}
              value={form.phone}
              onChange={(e) => change('phone', e.target.value)}
              placeholder="Ej. +54 …"
            />
          </Field>
        )}
        {!quickAppsSale && form.fulfillment === 'DELIVERY' && (
          <>
            <Field label="Zona de entrega">
              <select required value={form.zone} onChange={(e) => change('zone', e.target.value)}>
                <option value="">Elegí tu zona</option>
                {settings.zones
                  .filter((z: any) => z.enabled)
                  .map((z: any) => (
                    <option key={z.id} value={z.id}>
                      {z.name} · {money(z.fee)}
                    </option>
                  ))}
              </select>
            </Field>
            {zone && (
              <p className="muted">
                Mínimo de productos: {money(zone.minimum)}. Confirmá que tu dirección está dentro de
                esta zona.
              </p>
            )}
            <Field label="Calle, número, piso y referencias">
              <input
                required
                autoComplete="street-address"
                value={form.address}
                onChange={(e) => change('address', e.target.value)}
              />
            </Field>
          </>
        )}
        {manual && !quickAppsSale ? (
          <Field label="Medio de pago">
            <select required value={form.method} onChange={(e) => change('method', e.target.value)}>
              {methods.map((method) => (
                <option key={method.id} value={method.id}>
                  {method.name}
                </option>
              ))}
            </select>
          </Field>
        ) : (
          <fieldset className="checkout-payment">
            <legend>Medio de pago</legend>
            <div className="checkout-payment-options">
              {methods.map((method) => {
                const Icon = paymentIcons.get(method.id) ?? CreditCard;
                return (
                  <label className="checkout-payment-option" key={method.id}>
                    <input
                      type="radio"
                      name="payment-method"
                      value={method.id}
                      checked={form.method === method.id}
                      onChange={() => change('method', method.id)}
                      required
                    />
                    <span className="checkout-payment-card">
                      <Icon size={20} aria-hidden="true" />
                      <span>{method.name}</span>
                      <Check className="checkout-payment-check" size={16} aria-hidden="true" />
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        )}
        {form.method === 'transfer' && (
          <p className="notice">
            La transferencia queda pendiente hasta que el local verifique el ingreso.
          </p>
        )}
        {form.method === 'mercadopago_online' && (
          <p className="notice">
            Vas a pagar en Mercado Pago. El pedido llega a cocina cuando se acredita el pago.
          </p>
        )}
        {!quickAppsSale && (
          <Field label="Nota del pedido (opcional)">
            <textarea
              value={form.notes}
              onChange={(e) => change('notes', e.target.value)}
              maxLength={500}
            />
          </Field>
        )}
        <div className="receipt">
          {cart.map((l, i) => (
            <div key={i}>
              <span>
                {l.quantity} × {l.label}
              </span>
              <b>{money(l.quantity * l.displayPrice)}</b>
            </div>
          ))}
          {appliedDiscount > 0 && (
            <div>
              <span>Descuento</span>
              <b>{money(-appliedDiscount)}</b>
            </div>
          )}
          {shipping > 0 && (
            <div>
              <span>Envío</span>
              <b>{money(shipping)}</b>
            </div>
          )}
          <div className="receipt-total">
            <span>{quickAppsSale ? 'Total a cobrar' : 'Total estimado'}</span>
            <b>{money(total)}</b>
          </div>
        </div>
        {!quickAppsSale && (
          <p className="muted small">
            El servidor verifica el precio y la disponibilidad al confirmar. Demora estimada:{' '}
            {settings.delay} min.
          </p>
        )}
        <ErrorBox message={error} />
        <button className="primary full" disabled={busy || !form.method}>
          {busy
            ? 'Guardando pedido…'
            : manual
              ? 'Registrar venta'
              : form.method === 'mercadopago_online'
                ? 'Pagar con Mercado Pago'
                : 'Confirmar pedido'}
          <ArrowRight size={18} />
        </button>
      </form>
    </Modal>
  );
}
export default function Shop() {
  const router = useRouter();
  const logoClicks = useRef({ count: 0, last: 0 });
  const dismissBag = useRef<() => void>(null);
  const [data, setData] = useState<any>(null),
    [error, setError] = useState(''),
    [category, setCategory] = useState('Todos'),
    [query, setQuery] = useState(''),
    [cart, setCart] = useState<CartLine[]>([]),
    [product, setProduct] = useState<Product | null>(null),
    [bag, setBag] = useState<'added' | 'review' | null>(null),
    [checkout, setCheckout] = useState(false);

  function tapLogo() {
    const now = Date.now();
    const clicks = logoClicks.current;
    const count = now - clicks.last < 2000 ? clicks.count + 1 : 1;
    logoClicks.current = { count: count === 5 ? 0 : count, last: now };
    if (count === 5) router.push('/admin');
  }

  useEffect(() => {
    api('catalog')
      .then(setData)
      .catch((e) => setError(e.message));
    const id = setInterval(
      () =>
        api('catalog')
          .then(setData)
          .catch(() => {}),
      30000,
    );
    return () => clearInterval(id);
  }, []);
  const logo = (
    <button type="button" className="shop-logo-button" onClick={tapLogo}>
      <Brand />
    </button>
  );
  if (!data)
    return (
      <>
        <nav className="shop-nav">{logo}</nav>
        {error ? <ErrorBox message={error} /> : <Loading />}
      </>
    );
  const products = [...(data.products as Product[])].sort(
    (a, b) => menuCategoryRank(a.category) - menuCategoryRank(b.category),
  );
  const cats = ['Todos', ...new Set(products.map((p) => p.category))];
  const filtered = products.filter(
    (p) =>
      (category === 'Todos' || category === p.category) &&
      p.name.toLowerCase().includes(query.toLowerCase()),
  );
  const count = cart.reduce((a, l) => a + l.quantity, 0),
    total = cart.reduce((a, l) => a + l.quantity * l.displayPrice, 0);
  const itemCount = `${count} ${count === 1 ? 'producto' : 'productos'}`;
  const next = data.opening.nextOpen
    ? new Intl.DateTimeFormat('es-AR', {
        weekday: 'long',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'America/Argentina/Buenos_Aires',
      }).format(new Date(data.opening.nextOpen))
    : null;
  return (
    <div className="storefront">
      <nav className="shop-nav">
        {logo}
        <button
          type="button"
          className="bag-button"
          aria-label={`Mi pedido, ${itemCount}`}
          onClick={() => setBag('review')}
        >
          <ShoppingBag size={19} />
          <span>Mi pedido</span>
          <b>{count}</b>
        </button>
      </nav>
      <section className="shop-hero">
        <div className="hero-copy">
          <span className="eyebrow">
            <span className="live-dot" />
            SMASH BURGERS · BURGER TILÍN
          </span>
          <h1>
            El antojo tiene
            <br />
            nombre<span>.</span>
          </h1>
          <p>
            Elegí tu favorita. Nosotros prendemos
            <br />
            la plancha y nos encargamos del resto.
          </p>
          <a className="primary" href="#menu">
            Ver el menú <ArrowRight size={19} />
          </a>
        </div>
        <div className="hero-photo" role="img" aria-label="Hamburguesa de Burger Tilín" />
        <div className="hero-stamp">
          <Flame size={22} />
          <span>
            HECHAS
            <br />
            <b>AL MOMENTO</b>
          </span>
        </div>
      </section>
      <div className="store-info">
        <span className={data.opening.open ? 'open-label' : 'closed-label'}>
          <span className="live-dot" />
          {data.opening.open
            ? 'Estamos tomando pedidos'
            : data.opening.paused
              ? 'Pedidos en pausa'
              : 'Ahora estamos cerrados'}
        </span>
        <span>
          <Clock size={17} />
          {data.settings.delay} min estimados
        </span>
        <span>
          <Store size={17} />
          Retiro en el local
        </span>
        <a className="store-delivery-link" href="#zona-de-envio">
          <Truck size={17} aria-hidden="true" />
          Envío gratis · Ver zona
        </a>
      </div>
      {!data.opening.open && (
        <div className="closed-message">
          {data.opening.paused
            ? 'Estamos haciendo una pausa. Volvé a consultar en unos minutos.'
            : next
              ? `Volvemos el ${next}.`
              : 'Pronto vas a poder pedir por acá.'}{' '}
          Podés recorrer el menú.
        </div>
      )}
      <main className="shop-main" id="menu">
        <div className="section-heading">
          <div>
            <span className="eyebrow orange">DIRECTO DE LA PLANCHA</span>
            <h2>¿Qué sale hoy?</h2>
          </div>
          <label className="search">
            <Search size={18} />
            <input
              aria-label="Buscar en el menú"
              placeholder="Buscá tu favorita…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
        </div>
        <div className="category-tabs">
          {cats.map((c) => (
            <button
              className={category === c ? 'active' : ''}
              key={c}
              onClick={() => setCategory(c)}
            >
              {c}
            </button>
          ))}
        </div>
        {filtered.length ? (
          <div className="product-grid">
            {filtered.map((p) => (
              <article className="product-card" key={p.id}>
                <div className="product-photo">
                  {p.image && <img src={p.image} alt={p.name} />}
                  <span className="photo-tag">{p.category}</span>
                  {!p.available && <span className="sold-out-tag">Agotado</span>}
                </div>
                <div className="product-copy">
                  <h3>{p.name}</h3>
                  <p>{p.description}</p>
                  <div>
                    <strong>{money(p.price)}</strong>
                    <button
                      className="add-product"
                      disabled={!p.available || !data.opening.open}
                      onClick={() => setProduct(p)}
                      aria-label={`Agregar ${p.name}`}
                    >
                      <Plus size={22} />
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <Empty title="La plancha se está preparando">
            Estamos terminando nuestro menú. Volvé pronto para elegir tu próxima burger.
          </Empty>
        )}
        <div className="store-note">
          <Flame size={20} />
          <p>
            Tu pedido se prepara al momento.
            <br />
            <span>Elegí los extras y las modificaciones antes de confirmar.</span>
          </p>
          {data.settings.whatsapp && (
            <a href={`https://wa.me/${data.settings.whatsapp}`} target="_blank" rel="noreferrer">
              Escribinos por WhatsApp <ArrowUpRight size={17} />
            </a>
          )}
        </div>
        <section
          className="shop-delivery"
          id="zona-de-envio"
          aria-labelledby="zona-de-envio-titulo"
        >
          <div className="shop-delivery-copy">
            <h2 id="zona-de-envio-titulo">Envío gratis</h2>
            <p>Hacemos delivery únicamente dentro de la zona marcada en el mapa.</p>
            <p className="shop-delivery-bounds">
              <MapPin size={20} aria-hidden="true" />
              <span>Entre Nogoyá, Bermúdez, Av. Juan B. Justo y Av. General Paz.</span>
            </p>
            <p>Si estás fuera de esa zona, podés retirar tu pedido en el local.</p>
            <a href="/zona-de-envio" target="_blank" rel="noopener noreferrer">
              Ampliar mapa <ArrowUpRight size={18} aria-hidden="true" />
            </a>
          </div>
          <DeliveryMap />
        </section>
      </main>
      <footer className="shop-footer">
        <Brand />
        <span>Buenas burgers. Buenos momentos.</span>
      </footer>
      {product && (
        <Customize
          product={product}
          products={products}
          close={() => setProduct(null)}
          add={(l) => {
            sessionStorage.removeItem('tilin-checkout-key');
            if (cart.length === 0) setBag('added');
            setCart((items) => [...items, l]);
          }}
        />
      )}
      {bag && !product && (
        <Modal
          title={bag === 'added' && count > 0 ? 'Agregado a tu pedido' : `Tu pedido · ${itemCount}`}
          close={() => setBag(null)}
          dismissRef={dismissBag}
        >
          {cart.length ? (
            <>
              <div className="cart-lines">
                {cart.map((l, i) => (
                  <div key={i}>
                    <div>
                      <b>
                        {l.quantity} × {l.label}
                      </b>
                      {l.note && <p>{l.note}</p>}
                    </div>
                    <strong>{money(l.displayPrice * l.quantity)}</strong>
                    <button
                      className="icon-btn"
                      aria-label="Quitar producto"
                      onClick={() => {
                        setCart(cart.filter((_, j) => j !== i));
                        sessionStorage.removeItem('tilin-checkout-key');
                      }}
                    >
                      <Minus size={18} />
                    </button>
                  </div>
                ))}
              </div>
              <div className="cart-subtotal">
                <span>Subtotal</span>
                <strong>{money(total)}</strong>
              </div>
              {!data.opening.open && <p className="muted">Ahora no estamos tomando pedidos.</p>}
              <div className="cart-actions">
                <button type="button" className="secondary" onClick={() => dismissBag.current?.()}>
                  Seguir comprando
                </button>
                <button
                  type="button"
                  className="primary"
                  disabled={!data.opening.open}
                  onClick={() => {
                    setCheckout(true);
                    dismissBag.current?.();
                  }}
                >
                  Ir a pagar <ArrowRight size={18} aria-hidden="true" />
                </button>
              </div>
            </>
          ) : (
            <Empty title="Acá empieza algo rico">Agregá tu favorita para armar el pedido.</Empty>
          )}
        </Modal>
      )}
      {checkout && !bag && (
        <Checkout
          cart={cart}
          settings={data.settings}
          close={() => setCheckout(false)}
          done={(r) => {
            setCart([]);
            window.location.assign(r.checkoutUrl || `/seguimiento/${r.tracking}`);
          }}
        />
      )}
      {count > 0 && !product && !bag && !checkout && (
        <button type="button" className="floating-cart primary" onClick={() => setBag('review')}>
          <ShoppingBag size={20} aria-hidden="true" />
          Ver pedido · {money(total)}
          <ArrowRight size={18} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
