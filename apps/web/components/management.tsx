'use client';
import { useState, useEffect, useRef } from 'react';
import { Plus, Search, Save, Package, ArrowUpRight, Check, AlertTriangle, X } from 'lucide-react';
import { api, money, Product, emptyConfig, date } from '../lib/api';
import { Field, Modal, Empty, ErrorBox, Toggle } from './ui';
import ImagePicker from './image-picker';
import ChannelPrices from './channel-prices';
import { AccessPanel, AuditPanel } from './access-panel';
import ArchiveDialog from './archive-dialog';
function RecipeEditor({
  value,
  onChange,
  ingredients,
}: {
  value: any[];
  onChange: (v: any[]) => void;
  ingredients: any[];
}) {
  return (
    <div className="recipe-editor">
      {value.map((r, i) => (
        <div className="recipe-row" key={i}>
          <select
            aria-label="Insumo"
            value={r.ingredientId}
            onChange={(e) =>
              onChange(value.map((x, j) => (i === j ? { ...x, ingredientId: e.target.value } : x)))
            }
          >
            <option value="">Elegí insumo</option>
            {ingredients.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name} ({x.unit})
              </option>
            ))}
          </select>
          <input
            type="number"
            aria-label="Cantidad en unidad base"
            min="1"
            value={r.quantity}
            onChange={(e) =>
              onChange(
                value.map((x, j) => (i === j ? { ...x, quantity: Number(e.target.value) } : x)),
              )
            }
          />
          <label className="check-row">
            <Toggle
              checked={r.removable}
              onChange={(e) =>
                onChange(value.map((x, j) => (i === j ? { ...x, removable: e.target.checked } : x)))
              }
            />
            Se puede quitar
          </label>
          <button
            type="button"
            className="icon-btn"
            aria-label="Quitar insumo"
            onClick={() => onChange(value.filter((_, j) => j !== i))}
          >
            <X size={20} />
          </button>
        </div>
      ))}
      <button
        type="button"
        className="secondary small"
        disabled={!ingredients.length}
        onClick={() =>
          onChange([...value, { ingredientId: ingredients[0].id, quantity: 1, removable: false }])
        }
      >
        <Plus size={15} />
        Agregar insumo
      </button>
      {!ingredients.length && (
        <p className="muted small">
          Creá insumos en Inventario. Podés vender sin recetas y completarlas después; el margen se
          mostrará incompleto.
        </p>
      )}
    </div>
  );
}
function ProductEditor({
  product,
  products,
  close,
  saved,
}: {
  product: Product | null;
  products: Product[];
  close: () => void;
  saved: () => void;
}) {
  const [form, setForm] = useState<any>(
      product
        ? { ...product, config: { ...emptyConfig, ...product.config } }
        : {
            name: '',
            category: 'Hamburguesas',
            description: '',
            image: '',
            price: null,
            published: false,
            soldOut: false,
            favorite: false,
            config: structuredClone(emptyConfig),
          },
    ),
    [ingredients, setIngredients] = useState<any[]>([]),
    [tab, setTab] = useState('general'),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const dismiss = useRef<() => void>(null);
  useEffect(() => {
    api('admin/inventory').then((d) => setIngredients(d.ingredients));
  }, []);
  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));
  const config = (k: string, v: any) =>
    setForm((f: any) => ({ ...f, config: { ...f.config, [k]: v } }));
  const update = (key: string, index: number, k: string, v: any) =>
    config(
      key,
      form.config[key].map((x: any, i: number) => (i === index ? { ...x, [k]: v } : x)),
    );
  return (
    <Modal
      wide
      title={product ? 'Editar producto' : 'Nuevo producto'}
      close={close}
      dismissRef={dismiss}
    >
      <div className="category-tabs">
        {[
          ['general', 'Producto'],
          ['recipe', 'Receta'],
          ['variants', 'Variantes y extras'],
          ['slots', 'Combo'],
          ['advanced', 'Precios y promoción'],
        ].map(([k, l]) => (
          <button className={tab === k ? 'active' : ''} onClick={() => setTab(k)} key={k}>
            {l}
          </button>
        ))}
      </div>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (uploading) return;
          setBusy(true);
          try {
            await api(
              product ? `admin/products/${product.id}` : 'admin/products',
              form,
              product ? 'PATCH' : 'POST',
            );
            saved();
            dismiss.current?.();
          } catch (e: any) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {tab === 'general' && (
          <>
            <div className="form-grid">
              <Field label="Nombre">
                <input required value={form.name} onChange={(e) => set('name', e.target.value)} />
              </Field>
              <Field label="Categoría">
                <input
                  required
                  list="categories"
                  value={form.category}
                  onChange={(e) => set('category', e.target.value)}
                />
                <datalist id="categories">
                  {['Hamburguesas', 'Combos', 'Promociones', 'Papas', 'Bebidas', 'Extras'].map(
                    (c) => (
                      <option key={c}>{c}</option>
                    ),
                  )}
                </datalist>
              </Field>
            </div>
            <Field label="Descripción / ingredientes confirmados">
              <textarea
                value={form.description}
                onChange={(e) => set('description', e.target.value)}
              />
            </Field>
            <Field label="Precio en pesos argentinos">
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.price === null ? '' : form.price / 100}
                onChange={(e) =>
                  set(
                    'price',
                    e.target.value === '' ? null : Math.round(Number(e.target.value) * 100),
                  )
                }
              />
            </Field>
            <ImagePicker
              value={form.image}
              onChange={(v) => set('image', v)}
              busyChanged={setUploading}
            />
            <label className="check-row">
              <Toggle
                checked={form.published}
                onChange={(e) => set('published', e.target.checked)}
              />
              Publicar para vender
            </label>
            <label className="check-row">
              <Toggle checked={form.favorite} onChange={(e) => set('favorite', e.target.checked)} />
              Favorito en venta rápida
            </label>
          </>
        )}
        {tab === 'recipe' && (
          <>
            <h3>Consumo por unidad</h3>
            <p className="muted small">
              Usá gramos, mililitros o unidades. Incluí el packaging. Cada variante puede reemplazar
              esta receta.
            </p>
            <RecipeEditor
              value={form.config.recipe}
              onChange={(v) => config('recipe', v)}
              ingredients={ingredients}
            />
          </>
        )}
        {tab === 'variants' && (
          <>
            {['variants', 'extras'].map((key) => (
              <section key={key}>
                <h3>{key === 'variants' ? 'Variantes' : 'Extras'}</h3>
                {form.config[key].map((v: any, i: number) => (
                  <div className="editor-block" key={v.id}>
                    <div className="form-grid">
                      <Field label="Nombre">
                        <input
                          value={v.name}
                          required
                          onChange={(e) => update(key, i, 'name', e.target.value)}
                        />
                      </Field>
                      <Field
                        label={
                          key === 'variants'
                            ? 'Diferencia de precio (ARS)'
                            : 'Precio adicional (ARS)'
                        }
                      >
                        <input
                          type="number"
                          min={key === 'variants' ? undefined : 0}
                          step="0.01"
                          value={(v.delta ?? v.price) / 100}
                          onChange={(e) =>
                            update(
                              key,
                              i,
                              key === 'variants' ? 'delta' : 'price',
                              Math.round(Number(e.target.value) * 100),
                            )
                          }
                        />
                      </Field>
                    </div>
                    <RecipeEditor
                      value={v.recipe}
                      onChange={(r) => update(key, i, 'recipe', r)}
                      ingredients={ingredients}
                    />
                    <button
                      type="button"
                      className="danger-text"
                      onClick={() =>
                        config(
                          key,
                          form.config[key].filter((_: any, j: number) => j !== i),
                        )
                      }
                    >
                      Eliminar
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="secondary"
                  onClick={() =>
                    config(key, [
                      ...form.config[key],
                      {
                        id: crypto.randomUUID(),
                        name: '',
                        ...(key === 'variants' ? { delta: 0 } : { price: 0 }),
                        recipe: [],
                      },
                    ])
                  }
                >
                  <Plus size={16} />
                  {key === 'variants' ? 'Agregar variante' : 'Agregar extra'}
                </button>
              </section>
            ))}
          </>
        )}
        {tab === 'slots' && (
          <>
            <h3>¿Qué incluye esta promo o combo?</h3>
            {!form.config.slots.length && (
              <button
                type="button"
                className="secondary"
                onClick={() =>
                  config(
                    'slots',
                    ['Hamburguesas', 'Papas', 'Bebidas'].map((name) => ({
                      id: crypto.randomUUID(),
                      name,
                      quantity: 1,
                      choices: [{ productId: '', delta: 0 }],
                    })),
                  )
                }
              >
                Empezar con hamburguesas + papas + bebidas
              </button>
            )}
            <p className="muted small">
              Agregá una parte por tipo de producto. Por ejemplo: 2 hamburguesas, 2 porciones de
              papas y 2 bebidas. El precio de todo el conjunto se carga en Producto. Dejá el recargo
              en $0 para lo que ya está incluido.
            </p>
            {form.config.slots.map((s: any, i: number) => (
              <div className="editor-block" key={s.id}>
                <div className="form-grid combo-group-fields">
                  <Field label="Qué incluye (ej. Hamburguesas, Papas o Bebidas)">
                    <input
                      required
                      value={s.name}
                      onChange={(e) => update('slots', i, 'name', e.target.value)}
                    />
                  </Field>
                  <Field label="Unidades incluidas en la promo">
                    <input
                      type="number"
                      min="1"
                      max="20"
                      value={s.quantity}
                      onChange={(e) => update('slots', i, 'quantity', Number(e.target.value))}
                    />
                  </Field>
                </div>
                {s.choices.map((ch: any, j: number) => (
                  <div className="combo-choice" key={j}>
                    <Field label="Producto">
                      <select
                        value={ch.productId}
                        aria-label="Producto componente"
                        onChange={(e) =>
                          update(
                            'slots',
                            i,
                            'choices',
                            s.choices.map((x: any, k: number) =>
                              j === k ? { ...x, productId: e.target.value } : x,
                            ),
                          )
                        }
                      >
                        <option value="">Elegí producto</option>
                        {products
                          .filter((p) => p.id !== product?.id && !p.config.slots.length)
                          .map((p) => (
                            <option value={p.id} key={p.id}>
                              {p.name}
                            </option>
                          ))}
                      </select>
                    </Field>
                    <Field label="Recargo por unidad">
                      <span className="money-input">
                        <span aria-hidden="true">$</span>
                        <input
                          type="number"
                          step="0.01"
                          aria-label="Diferencia ARS"
                          value={ch.delta / 100}
                          onChange={(e) =>
                            update(
                              'slots',
                              i,
                              'choices',
                              s.choices.map((x: any, k: number) =>
                                j === k
                                  ? { ...x, delta: Math.round(Number(e.target.value) * 100) }
                                  : x,
                              ),
                            )
                          }
                        />
                      </span>
                    </Field>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label="Quitar alternativa"
                      onClick={() =>
                        update(
                          'slots',
                          i,
                          'choices',
                          s.choices.filter((_: any, k: number) => j !== k),
                        )
                      }
                    >
                      <X size={20} />
                    </button>
                  </div>
                ))}
                <div className="row spread">
                  <button
                    type="button"
                    className="secondary"
                    onClick={() =>
                      update('slots', i, 'choices', [...s.choices, { productId: '', delta: 0 }])
                    }
                  >
                    Agregar alternativa para elegir
                  </button>
                  <button
                    type="button"
                    className="danger-text"
                    onClick={() =>
                      config(
                        'slots',
                        form.config.slots.filter((_: any, j: number) => i !== j),
                      )
                    }
                  >
                    Eliminar grupo
                  </button>
                </div>
              </div>
            ))}
            <button
              type="button"
              className="secondary"
              onClick={() =>
                config('slots', [
                  ...form.config.slots,
                  {
                    id: crypto.randomUUID(),
                    name: '',
                    quantity: 1,
                    choices: [{ productId: '', delta: 0 }],
                  },
                ])
              }
            >
              <Plus size={16} />
              Agregar otra parte (papas, bebida…)
            </button>
          </>
        )}
        {tab === 'advanced' && (
          <>
            <h3>Precios por canal</h3>
            <ChannelPrices
              value={form.config.channelPrices}
              onChange={(v) => config('channelPrices', v)}
            />
            <h3>Vigencia de la promoción</h3>
            <label className="check-row">
              <Toggle
                checked={!!form.config.promotion}
                onChange={(e) =>
                  config(
                    'promotion',
                    e.target.checked
                      ? { from: '', to: '', start: '00:00', end: '23:59', channels: [] }
                      : undefined,
                  )
                }
              />
              Limitar por fecha y horario
            </label>
            {form.config.promotion && (
              <>
                <div className="form-grid">
                  {[
                    ['from', 'Desde', 'date'],
                    ['to', 'Hasta', 'date'],
                    ['start', 'Hora inicial', 'time'],
                    ['end', 'Hora final', 'time'],
                  ].map(([k, l, t]) => (
                    <Field key={k} label={l}>
                      <input
                        type={t}
                        required
                        value={form.config.promotion[k]}
                        onChange={(e) =>
                          config('promotion', { ...form.config.promotion, [k]: e.target.value })
                        }
                      />
                    </Field>
                  ))}
                </div>
                <ChannelPrices
                  value={form.config.channelPrices}
                  onChange={() => {}}
                  selected={form.config.promotion.channels}
                  onSelect={(channels) =>
                    config('promotion', { ...form.config.promotion, channels })
                  }
                />
              </>
            )}
          </>
        )}
        <ErrorBox message={error} />
        <div className="modal-footer">
          <span className="muted small">Los cambios no modifican ventas anteriores.</span>
          <button className="primary" disabled={busy || uploading}>
            <Save size={17} />
            {busy ? 'Guardando…' : 'Guardar producto'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
export function JsonField({ value, onChange }: { value: any; onChange: (v: any) => void }) {
  const [text, setText] = useState(JSON.stringify(value, null, 2)),
    [error, setError] = useState('');
  return (
    <>
      <textarea
        className="json-field"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          try {
            onChange(JSON.parse(e.target.value));
            e.target.setCustomValidity('');
            setError('');
          } catch {
            e.target.setCustomValidity('Corregí el formato JSON antes de guardar');
            setError('JSON incompleto: revisá el formato antes de guardar.');
          }
        }}
      />
      <ErrorBox message={error} />
    </>
  );
}
type ManagedProduct = Product & {
  baseCost?: { ingredientCost: number | null; priceDelta: number; onlineMargin?: number };
};

export function ProductsView({ role }: { role: string }) {
  const showCosts = role === 'OWNER';
  const [products, setProducts] = useState<ManagedProduct[]>([]),
    [query, setQuery] = useState(''),
    [archived, setArchived] = useState(false),
    [archiveTarget, setArchiveTarget] = useState<Product>(),
    [editor, setEditor] = useState<Product | null | undefined>(),
    [error, setError] = useState(''),
    [priceModal, setPriceModal] = useState(false),
    [percent, setPercent] = useState(10),
    [preview, setPreview] = useState<any>();
  const [loadedArchived, setLoadedArchived] = useState<boolean>();
  const listRequest = useRef(0);
  const load = () => {
    const request = ++listRequest.current;
    return api(archived ? 'admin/products/archived' : 'admin/products')
      .then((rows) => {
        if (request !== listRequest.current) return;
        setProducts(rows);
        setLoadedArchived(archived);
      })
      .catch((e) => {
        if (request === listRequest.current) setError(e.message);
      });
  };
  useEffect(() => {
    load();
  }, [archived]);
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow orange">TU CARTA</span>
          <h1>Productos.</h1>
          <p className="muted">
            {showCosts
              ? 'El margen principal usa el precio general y el costo de la receta base. En combos se usan las opciones iniciales. Si figura Mercado Pago, esa cifra descuenta las comisiones estimadas de la venta web.'
              : 'Disponibilidad al toque. Datos comerciales bajo tu control.'}
          </p>
        </div>
        {role === 'OWNER' && !archived && (
          <div className="row">
            <button className="secondary" onClick={() => setPriceModal(true)}>
              Actualizar precios
            </button>
            <button className="primary" onClick={() => setEditor(null)}>
              <Plus size={18} />
              Nuevo producto
            </button>
          </div>
        )}
      </div>
      <ErrorBox message={error} />
      {role === 'OWNER' && (
        <div className="category-tabs">
          <button className={!archived ? 'active' : ''} onClick={() => setArchived(false)}>
            Activos
          </button>
          <button className={archived ? 'active' : ''} onClick={() => setArchived(true)}>
            Archivados
          </button>
        </div>
      )}
      <label className="search">
        <Search size={18} />
        <input
          placeholder="Buscar en el catálogo…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Producto</th>
              <th>Categoría</th>
              {role !== 'KITCHEN' && <th>Precio</th>}
              {showCosts && <th>Costo unitario</th>}
              {showCosts && <th>Margen estimado</th>}
              <th>Publicación</th>
              <th>Disponibilidad</th>
              {role === 'OWNER' && <th />}
            </tr>
          </thead>
          <tbody>
            {(loadedArchived === archived ? products : [])
              .filter((p) => p.name.toLowerCase().includes(query.toLowerCase()))
              .map((p) => {
                const cost = p.baseCost?.ingredientCost ?? null;
                const priceDelta = p.baseCost?.priceDelta ?? 0;
                const priceWithOptions = p.price === null ? null : p.price + priceDelta;
                const margin =
                  cost === null || priceWithOptions === null || priceWithOptions < 0
                    ? null
                    : priceWithOptions - cost;
                return (
                  <tr key={p.id}>
                    <td>
                      <div className="table-product">
                        {p.image && <img src={p.image} alt="" />}
                        <b>{p.name}</b>
                      </div>
                    </td>
                    <td>{p.category}</td>
                    {role !== 'KITCHEN' && (
                      <td>
                        {money(p.price)}
                        {showCosts && p.price !== null && priceDelta !== 0 && (
                          <small>Con opciones iniciales: {money(priceWithOptions)}</small>
                        )}
                      </td>
                    )}
                    {showCosts && (
                      <td>
                        {cost === null ? (
                          <span className="muted">Costo incompleto</span>
                        ) : (
                          money(cost)
                        )}
                      </td>
                    )}
                    {showCosts && (
                      <td>
                        {margin === null ? '—' : <b>{money(margin)}</b>}
                        {p.baseCost?.onlineMargin !== undefined && (
                          <small>Con Mercado Pago: {money(p.baseCost.onlineMargin)}</small>
                        )}
                      </td>
                    )}
                    <td>
                      <span className={'tag ' + (!archived && p.published ? 'green' : '')}>
                        {archived ? 'Archivado' : p.published ? 'Publicado' : 'Borrador'}
                      </span>
                    </td>
                    <td>
                      {archived ? (
                        '—'
                      ) : (
                        <button
                          className={'availability ' + (p.soldOut ? 'out' : '')}
                          onClick={async () => {
                            try {
                              await api(
                                `admin/products/${p.id}/availability`,
                                { soldOut: !p.soldOut },
                                'PATCH',
                              );
                              load();
                            } catch (e: any) {
                              setError(e.message);
                            }
                          }}
                        >
                          {p.soldOut ? 'Agotado' : 'Disponible'}
                        </button>
                      )}
                    </td>
                    {role === 'OWNER' && (
                      <td>
                        <div className="row">
                          {!archived && (
                            <button className="text-action" onClick={() => setEditor(p)}>
                              Editar <ArrowUpRight size={15} />
                            </button>
                          )}
                          <button
                            className={archived ? 'text-action' : 'danger-text'}
                            onClick={() => setArchiveTarget(p)}
                          >
                            {archived ? 'Restaurar' : 'Archivar'}
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
          </tbody>
        </table>
        {archived && loadedArchived === archived && products.length === 0 && (
          <Empty title="No hay productos archivados" />
        )}
      </div>
      {archiveTarget && (
        <ArchiveDialog
          name={archiveTarget.name}
          description={
            archived
              ? 'El producto volverá al catálogo con su configuración de publicación anterior.'
              : 'El producto saldrá de la tienda y de la venta rápida. Podés recuperarlo desde Archivados.'
          }
          path={`admin/products/${archiveTarget.id}`}
          restore={archived}
          close={() => setArchiveTarget(undefined)}
          changed={() => {
            setProducts((rows) => rows.filter((p) => p.id !== archiveTarget.id));
            load();
          }}
        />
      )}
      {editor !== undefined && (
        <ProductEditor
          product={editor}
          products={products}
          close={() => setEditor(undefined)}
          saved={load}
        />
      )}
      {priceModal && (
        <Modal
          title="Actualización masiva de precios"
          close={() => {
            setPriceModal(false);
            setPreview(undefined);
          }}
        >
          <Field label="Porcentaje (negativo para bajar)">
            <input
              type="number"
              value={percent}
              onChange={(e) => {
                setPercent(Number(e.target.value));
                setPreview(undefined);
              }}
            />
          </Field>
          <button
            className="secondary"
            onClick={async () => {
              try {
                setPreview(
                  await api('admin/prices', {
                    percent,
                    ids: products.map((p) => p.id),
                    confirm: false,
                  }),
                );
              } catch (e: any) {
                setError(e.message);
              }
            }}
          >
            Ver cambios antes de aplicar
          </button>
          {preview && (
            <>
              <div className="receipt">
                {preview.preview.map((p: any) => (
                  <div key={p.id}>
                    <span>{p.name}</span>
                    <b>
                      {money(p.before)} → {money(p.after)}
                    </b>
                  </div>
                ))}
              </div>
              <button
                className="primary full"
                onClick={async () => {
                  try {
                    await api('admin/prices', {
                      percent,
                      ids: products.map((p) => p.id),
                      confirm: true,
                      version: preview.version,
                    });
                    load();
                    setPriceModal(false);
                    setPreview(undefined);
                  } catch (e: any) {
                    setError(e.message);
                  }
                }}
              >
                Confirmar nuevos precios
              </button>
            </>
          )}
          <ErrorBox message={error} />
        </Modal>
      )}
    </>
  );
}
export function InventoryView({ role }: { role: string }) {
  const [data, setData] = useState<any>({ ingredients: [], movements: [], replenishment: [] }),
    [error, setError] = useState(''),
    [ingredient, setIngredient] = useState<any>(undefined),
    [archiveTarget, setArchiveTarget] = useState<{ id: string; name: string }>(),
    [movement, setMovement] = useState<any>(),
    [form, setForm] = useState({
      name: '',
      unit: 'unit',
      minimum: 0,
      strict: false,
      cost: null as number | null,
    }),
    [move, setMove] = useState({
      quantity: 1,
      unit: 'unit',
      kind: 'PURCHASE',
      direction: 'ADD',
      reason: '',
    }),
    [tab, setTab] = useState('stock');
  const [archivedIngredients, setArchivedIngredients] = useState<{ id: string; name: string }[]>(
    [],
  );
  const load = () =>
    api('admin/inventory')
      .then(setData)
      .catch((e) => setError(e.message));
  const loadArchived = () =>
    api('admin/inventory/archived')
      .then((result) => setArchivedIngredients(result.ingredients))
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow orange">SIN SORPRESAS</span>
          <h1>Inventario.</h1>
          <p className="muted">
            Las recetas se encargan del consumo. Acá registrás lo que entra y ajustás lo necesario.
          </p>
        </div>
        {role === 'OWNER' && tab !== 'archived' && (
          <button
            className="primary"
            onClick={() => {
              setIngredient(null);
              setForm({ name: '', unit: 'unit', minimum: 0, strict: false, cost: null });
            }}
          >
            <Plus size={18} />
            Nuevo insumo
          </button>
        )}
      </div>
      <ErrorBox message={error} />
      <div className="category-tabs">
        {[
          ['stock', 'Stock actual'],
          ['replenishment', `Reposición (${data.replenishment.length})`],
          ['movements', 'Movimientos'],
          ...(role === 'OWNER' ? [['archived', 'Archivados']] : []),
        ].map(([k, l]) => (
          <button
            key={k}
            className={tab === k ? 'active' : ''}
            onClick={() => {
              setTab(k);
              if (k === 'archived') loadArchived();
            }}
          >
            {l}
          </button>
        ))}
      </div>
      {tab === 'archived' ? (
        <div className="panel">
          {archivedIngredients.length ? (
            archivedIngredients.map((i) => (
              <div className="receipt-total" key={i.id}>
                <b>{i.name}</b>
                <button className="text-action" onClick={() => setArchiveTarget(i)}>
                  Restaurar
                </button>
              </div>
            ))
          ) : (
            <Empty title="No hay insumos archivados" />
          )}
        </div>
      ) : tab === 'movements' ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Insumo</th>
                <th>Cantidad</th>
                <th>Tipo / motivo</th>
              </tr>
            </thead>
            <tbody>
              {data.movements.map((m: any) => (
                <tr key={m.id}>
                  <td>{date(m.createdAt)}</td>
                  <td>{m.ingredient.name}</td>
                  <td>
                    {m.quantity} {m.ingredient.unit}
                  </td>
                  <td>
                    {m.kind}
                    <small>{m.reason}</small>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : tab === 'replenishment' ? (
        <div className="panel">
          <h2>Lista sugerida de reposición</h2>
          {data.replenishment.length ? (
            data.replenishment.map((i: any) => (
              <div className="receipt-total" key={i.id}>
                <span>{i.name}</span>
                <b>
                  {i.suggested} {i.unit}
                </b>
              </div>
            ))
          ) : (
            <Empty title="No hay insumos bajo el mínimo" />
          )}
        </div>
      ) : data.ingredients.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Insumo</th>
                <th>En stock</th>
                <th>Reservado</th>
                <th>Disponible</th>
                <th>Control</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.ingredients.map((i: any) => (
                <tr key={i.id}>
                  <td>
                    <b>{i.name}</b>
                    <small>
                      Mínimo {i.minimum} {i.unit}
                    </small>
                  </td>
                  <td>
                    {i.stock} {i.unit}
                  </td>
                  <td>{i.reserved}</td>
                  <td>
                    <span className={i.stock - i.reserved < i.minimum ? 'late' : ''}>
                      {i.stock - i.reserved} {i.unit}
                    </span>
                  </td>
                  <td>{i.strict ? 'Estricto' : 'Aproximado'}</td>
                  <td>
                    <div className="row">
                      <button
                        className="secondary small"
                        onClick={() => {
                          setMovement(i);
                          setMove({
                            quantity: 1,
                            unit: i.unit,
                            kind: 'PURCHASE',
                            direction: 'ADD',
                            reason: '',
                          });
                        }}
                      >
                        Registrar movimiento
                      </button>
                      {role === 'OWNER' && (
                        <>
                          <button
                            className="text-action"
                            onClick={() => {
                              setIngredient(i);
                              setForm({
                                name: i.name,
                                unit: i.unit,
                                minimum: i.minimum,
                                strict: i.strict,
                                cost: i.cost === null ? null : Number(i.cost),
                              });
                            }}
                          >
                            Editar
                          </button>
                          <button className="danger-text" onClick={() => setArchiveTarget(i)}>
                            Archivar
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty title="Empezá por los insumos importantes" icon={<Package size={35} />}>
          Podés controlar primero carne, pan y bebidas, y completar el resto después.
        </Empty>
      )}
      {archiveTarget && (
        <ArchiveDialog
          name={archiveTarget.name}
          description={
            tab === 'archived'
              ? 'El insumo volverá al inventario con su stock registrado.'
              : 'El insumo saldrá del stock actual y de reposición. Sus movimientos quedan en el historial.'
          }
          path={`admin/ingredients/${archiveTarget.id}`}
          restore={tab === 'archived'}
          close={() => setArchiveTarget(undefined)}
          changed={() => {
            if (tab === 'archived') loadArchived();
            load();
          }}
        />
      )}
      {ingredient !== undefined && (
        <Modal
          title={ingredient ? 'Editar insumo' : 'Nuevo insumo'}
          close={() => setIngredient(undefined)}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await api(
                  ingredient ? `admin/ingredients/${ingredient.id}` : 'admin/ingredients',
                  form,
                  ingredient ? 'PATCH' : 'POST',
                );
                load();
                setIngredient(undefined);
              } catch (e: any) {
                setError(e.message);
              }
            }}
          >
            <Field label="Nombre">
              <input
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </Field>
            <Field label="Unidad base">
              <select
                disabled={!!ingredient}
                value={form.unit}
                onChange={(e) => setForm({ ...form, unit: e.target.value })}
              >
                <option value="unit">Unidades</option>
                <option value="g">Gramos</option>
                <option value="ml">Mililitros</option>
              </select>
            </Field>
            <Field label="Stock mínimo (unidad base)">
              <input
                type="number"
                min="0"
                value={form.minimum}
                onChange={(e) => setForm({ ...form, minimum: Number(e.target.value) })}
              />
            </Field>
            <Field label="Costo por unidad base en pesos (opcional)">
              <input
                type="number"
                min="0"
                step="0.000001"
                value={form.cost === null ? '' : form.cost / 100}
                onChange={(e) =>
                  setForm({
                    ...form,
                    cost: e.target.value === '' ? null : Number(e.target.value) * 100,
                  })
                }
              />
            </Field>
            <label className="check-row">
              <Toggle
                checked={form.strict}
                onChange={(e) => setForm({ ...form, strict: e.target.checked })}
              />
              Bloquear ventas sin stock (control estricto)
            </label>
            <ErrorBox message={error} />
            <button className="primary full">Guardar insumo</button>
          </form>
        </Modal>
      )}
      {movement && (
        <Modal title={`Movimiento · ${movement.name}`} close={() => setMovement(null)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await api(`admin/ingredients/${movement.id}/movements`, {
                  ...move,
                  key: crypto.randomUUID(),
                });
                setMovement(null);
                load();
              } catch (e: any) {
                setError(e.message);
              }
            }}
          >
            <Field label="Tipo">
              <select
                value={move.kind}
                onChange={(e) => setMove({ ...move, kind: e.target.value })}
              >
                <option value="PURCHASE">Compra / recepción</option>
                <option value="ADJUSTMENT">Ajuste</option>
                <option value="WASTE">Merma / desperdicio</option>
                <option value="RETURN">Devolución explícita</option>
              </select>
            </Field>
            <div className="form-grid">
              <Field label="Cantidad">
                <input
                  required
                  type="number"
                  min="0.001"
                  step="any"
                  value={move.quantity}
                  onChange={(e) => setMove({ ...move, quantity: Number(e.target.value) })}
                />
              </Field>
              <Field label="Unidad">
                <select
                  value={move.unit}
                  onChange={(e) => setMove({ ...move, unit: e.target.value })}
                >
                  {(movement.unit === 'g'
                    ? ['g', 'kg']
                    : movement.unit === 'ml'
                      ? ['ml', 'l']
                      : ['unit']
                  ).map((u) => (
                    <option key={u}>{u}</option>
                  ))}
                </select>
              </Field>
            </div>
            {move.kind === 'ADJUSTMENT' && (
              <Field label="Dirección">
                <select
                  value={move.direction}
                  onChange={(e) => setMove({ ...move, direction: e.target.value })}
                >
                  <option value="ADD">Sumar</option>
                  <option value="REMOVE">Restar</option>
                </select>
              </Field>
            )}
            <Field label="Motivo / comprobante">
              <input
                required
                minLength={3}
                value={move.reason}
                onChange={(e) => setMove({ ...move, reason: e.target.value })}
              />
            </Field>
            <ErrorBox message={error} />
            <button className="primary full">Guardar movimiento</button>
          </form>
        </Modal>
      )}
    </>
  );
}
export function SettingsView() {
  const [settings, setSettings] = useState<any>(),
    [error, setError] = useState(''),
    [success, setSuccess] = useState(false),
    [tab, setTab] = useState('local'),
    [newUser, setNewUser] = useState({ email: '', password: '', role: 'KITCHEN' });
  useEffect(() => {
    api('admin/settings')
      .then(setSettings)
      .catch((e) => setError(e.message));
  }, []);
  if (!settings) return <ErrorBox message={error} />;
  const set = (k: string, v: any) => {
    setSettings({ ...settings, [k]: v });
    setSuccess(false);
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow orange">A TU MANERA</span>
          <h1>Configuración.</h1>
          <p className="muted">Prepará el local una vez y simplificá cada turno.</p>
        </div>
      </div>
      <div className="category-tabs">
        {[
          ['local', 'Local'],
          ['hours', 'Horarios'],
          ['zones', 'Delivery'],
          ['payments', 'Pagos y canales'],
          ['users', 'Accesos'],
          ['audit', 'Historial de cambios'],
        ].map(([k, l]) => (
          <button className={tab === k ? 'active' : ''} key={k} onClick={() => setTab(k)}>
            {l}
          </button>
        ))}
      </div>
      <div className="panel settings-panel">
        {tab === 'users' && <AccessPanel />}
        {tab === 'audit' ? (
          <AuditPanel />
        ) : tab === 'users' ? (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await api('admin/users', newUser);
                setNewUser({ email: '', password: '', role: 'KITCHEN' });
                setSuccess(true);
              } catch (e: any) {
                setError(e.message);
              }
            }}
          >
            <h2>Crear acceso del equipo</h2>
            <Field label="Correo">
              <input
                required
                type="email"
                value={newUser.email}
                onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
              />
            </Field>
            <Field label="Contraseña (mínimo 12 caracteres)">
              <input
                required
                type="password"
                minLength={12}
                value={newUser.password}
                onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
              />
            </Field>
            <Field label="Permiso">
              <select
                value={newUser.role}
                onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}
              >
                <option value="KITCHEN">Cocina</option>
                <option value="CASHIER">Caja</option>
                <option value="OWNER">Dueño</option>
              </select>
            </Field>
            <button className="primary">Crear acceso</button>
          </form>
        ) : (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setError('');
              try {
                setSettings(await api('admin/settings', settings, 'PATCH'));
                setSuccess(true);
              } catch (e: any) {
                setError(e.message);
              }
            }}
          >
            {tab === 'local' && (
              <>
                <h2>Datos de Burger Tilín</h2>
                <Field label="Dirección de retiro">
                  <input
                    value={settings.pickupAddress}
                    onChange={(e) => set('pickupAddress', e.target.value)}
                  />
                </Field>
                <Field label="WhatsApp (solo números, código de país y área)">
                  <input
                    value={settings.whatsapp}
                    onChange={(e) => set('whatsapp', e.target.value)}
                  />
                </Field>
                <Field label="Demora estimada (minutos)">
                  <input
                    type="number"
                    min="5"
                    max="240"
                    value={settings.delay}
                    onChange={(e) => set('delay', Number(e.target.value))}
                  />
                </Field>
                <label className="check-row">
                  <Toggle
                    checked={settings.paused}
                    onChange={(e) => set('paused', e.target.checked)}
                  />
                  Pausar nuevos pedidos web
                </label>
              </>
            )}
            {tab === 'hours' && (
              <>
                <h2>Horarios de atención</h2>
                <p className="muted">
                  Hora de Buenos Aires. Si el cierre es anterior a la apertura, termina al día
                  siguiente. No se toman pedidos programados.
                </p>
                {settings.schedule.map((s: any, i: number) => (
                  <div className="recipe-row" key={i}>
                    <select
                      value={s.day}
                      aria-label="Día"
                      onChange={(e) =>
                        set(
                          'schedule',
                          settings.schedule.map((x: any, j: number) =>
                            i === j ? { ...x, day: Number(e.target.value) } : x,
                          ),
                        )
                      }
                    >
                      {[
                        'Lunes',
                        'Martes',
                        'Miércoles',
                        'Jueves',
                        'Viernes',
                        'Sábado',
                        'Domingo',
                      ].map((d, j) => (
                        <option value={j + 1} key={d}>
                          {d}
                        </option>
                      ))}
                    </select>
                    {['open', 'close'].map((k) => (
                      <input
                        type="time"
                        aria-label={k === 'open' ? 'Apertura' : 'Cierre'}
                        key={k}
                        required
                        value={s[k]}
                        onChange={(e) =>
                          set(
                            'schedule',
                            settings.schedule.map((x: any, j: number) =>
                              i === j ? { ...x, [k]: e.target.value } : x,
                            ),
                          )
                        }
                      />
                    ))}
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label="Quitar horario"
                      onClick={() =>
                        set(
                          'schedule',
                          settings.schedule.filter((_: any, j: number) => i !== j),
                        )
                      }
                    >
                      <X size={20} />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="secondary"
                  onClick={() =>
                    set('schedule', [...settings.schedule, { day: 1, open: '', close: '' }])
                  }
                >
                  <Plus size={16} />
                  Agregar horario
                </button>
                <Field label="Cierres excepcionales (fechas YYYY-MM-DD, separadas por coma)">
                  <input
                    value={settings.closures.join(',')}
                    onChange={(e) =>
                      set(
                        'closures',
                        e.target.value
                          ? e.target.value.split(',').map((s: string) => s.trim())
                          : [],
                      )
                    }
                  />
                </Field>
              </>
            )}
            {tab === 'zones' && (
              <>
                <h2>Zonas y tarifas</h2>
                <p className="muted">
                  Definí los barrios o límites en el nombre. El cliente selecciona una zona; no hay
                  validación geográfica automática en esta versión.
                </p>
                {settings.zones.map((z: any, i: number) => (
                  <div className="editor-block" key={z.id}>
                    {[
                      ['name', 'Zona y límites'],
                      ['fee', 'Envío (ARS)'],
                      ['minimum', 'Mínimo de compra (ARS)'],
                    ].map(([k, l]) => (
                      <Field label={l} key={k}>
                        <input
                          required
                          type={k === 'name' ? 'text' : 'number'}
                          min="0"
                          value={k === 'name' ? z[k] : z[k] / 100}
                          onChange={(e) =>
                            set(
                              'zones',
                              settings.zones.map((x: any, j: number) =>
                                i === j
                                  ? {
                                      ...x,
                                      [k]:
                                        k === 'name'
                                          ? e.target.value
                                          : Math.round(Number(e.target.value) * 100),
                                    }
                                  : x,
                              ),
                            )
                          }
                        />
                      </Field>
                    ))}
                    <label className="check-row">
                      <Toggle
                        checked={z.enabled}
                        onChange={(e) =>
                          set(
                            'zones',
                            settings.zones.map((x: any, j: number) =>
                              i === j ? { ...x, enabled: e.target.checked } : x,
                            ),
                          )
                        }
                      />
                      Habilitada
                    </label>
                  </div>
                ))}
                <button
                  type="button"
                  className="secondary"
                  onClick={() =>
                    set('zones', [
                      ...settings.zones,
                      { id: crypto.randomUUID(), name: '', fee: 0, minimum: 0, enabled: false },
                    ])
                  }
                >
                  Agregar zona
                </button>
              </>
            )}
            {tab === 'payments' && (
              <>
                <h2>Medios de pago</h2>
                <p className="notice">
                  {settings.mercadoPagoAvailable
                    ? 'Mercado Pago está disponible en la tienda. El pago se verifica automáticamente.'
                    : 'Mercado Pago online se habilita con las credenciales de tu cuenta vendedora. Agregar un medio manual no habilita el cobro online.'}
                </p>
                {settings.methods.map((m: any, i: number) => (
                  <div className="editor-block" key={m.id}>
                    <div className="form-grid">
                      <Field label={`Nombre (${m.id})`}>
                        <input
                          value={m.name}
                          onChange={(e) =>
                            set(
                              'methods',
                              settings.methods.map((x: any, j: number) =>
                                i === j ? { ...x, name: e.target.value } : x,
                              ),
                            )
                          }
                        />
                      </Field>
                      <Field label="Comisión %">
                        <input
                          type="number"
                          min="0"
                          max="100"
                          step="0.01"
                          value={m.feeBps / 100}
                          onChange={(e) =>
                            set(
                              'methods',
                              settings.methods.map((x: any, j: number) =>
                                i === j
                                  ? { ...x, feeBps: Math.round(Number(e.target.value) * 100) }
                                  : x,
                              ),
                            )
                          }
                        />
                      </Field>
                    </div>
                    <div className="row">
                      <label className="check-row">
                        <Toggle
                          checked={m.enabled}
                          onChange={(e) =>
                            set(
                              'methods',
                              settings.methods.map((x: any, j: number) =>
                                i === j ? { ...x, enabled: e.target.checked } : x,
                              ),
                            )
                          }
                        />
                        Habilitado
                      </label>
                      <label className="check-row">
                        <Toggle checked={m.cash} disabled onChange={() => {}} />
                        Afecta efectivo
                      </label>
                      <label className="check-row">
                        <Toggle
                          checked={m.receivable || false}
                          disabled={m.cash}
                          onChange={(e) =>
                            set(
                              'methods',
                              settings.methods.map((x: any, j: number) =>
                                i === j ? { ...x, receivable: e.target.checked } : x,
                              ),
                            )
                          }
                        />
                        Liquidación posterior de plataforma
                      </label>
                    </div>
                  </div>
                ))}
                <button
                  type="button"
                  className="secondary"
                  onClick={() =>
                    set('methods', [
                      ...settings.methods,
                      {
                        id: crypto.randomUUID(),
                        name: 'Nuevo medio',
                        feeBps: 0,
                        cash: false,
                        enabled: false,
                      },
                    ])
                  }
                >
                  Agregar medio
                </button>
                <h2>Canales de venta</h2>
                {settings.channels.map((c: any, i: number) => (
                  <div className="form-grid" key={c.id}>
                    <Field label={`Comisión de ${c.name} (%)`}>
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="0.01"
                        value={c.feeBps / 100}
                        onChange={(e) =>
                          set(
                            'channels',
                            settings.channels.map((x: any, j: number) =>
                              i === j
                                ? { ...x, feeBps: Math.round(Number(e.target.value) * 100) }
                                : x,
                            ),
                          )
                        }
                      />
                    </Field>
                  </div>
                ))}
              </>
            )}
            <div className="modal-footer">
              <button className="primary">
                <Save size={17} />
                Guardar configuración
              </button>
            </div>
          </form>
        )}
        <ErrorBox message={error} />
        {success && (
          <div className="success-message">
            <Check size={17} />
            Guardado correctamente
          </div>
        )}
      </div>
    </>
  );
}
