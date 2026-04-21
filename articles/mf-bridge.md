# Устал копипастить boilerplate для микрофронтендов — написал свой пакет

На одном из проектов мы перешли на Module Federation. Схема стандартная: хост-шелл плюс несколько независимых ремоутов, каждый деплоится своей командой. Архитектурно всё выглядело чисто — до момента, когда нужно было реально встраивать ремоуты в хост.

## Что раздражало

Каждый раз, добавляя новый MF-слот, я писал примерно одно и то же:

```tsx
let root: Root | null = null

async function mount(el: HTMLElement, props: unknown) {
  const { CheckoutWidget } = await import('checkout/App')
  root = createRoot(el)
  root.render(<CheckoutWidget {...(props as any)} />)
}

function update(props: unknown) {
  // держим ссылку на root и перерендериваем
  root?.render(<CheckoutWidget {...(props as any)} />)
}

el.addEventListener('propsChanged', (e) => update((e as CustomEvent).detail))
mount(mountEl, initialProps)
```

Строк пятнадцать на слот. На странице таких слотов пять — уже семьдесят строк одного и того же. Везде `as any`, потому что на границе модулей TypeScript уже ничего не знает о пропсах ремоута. Ошибка в названии пропа обнаруживается только в рантайме.

На втором проекте с MF я снова столкнулся с тем же. Скопировал тот же код, поправил под новый компонент. На третьем — понял, что хочу это решить один раз.

## Что сделал

Написал `@mf-toolkit/mf-bridge`. Задача была конкретная: убрать boilerplate и вернуть типы на границе между хостом и ремоутом.

Пакет строится на трёх вещах.

**Контракт на стороне ремоута.** Ремоут оборачивает свой компонент один раз:

```tsx
// checkout-remote/entry.ts
import { createMFEntry } from '@mf-toolkit/mf-bridge/entry'
import { CheckoutWidget } from './CheckoutWidget'

export const register = createMFEntry(CheckoutWidget)
```

`register` — это типизированный объект с методами `mount`, `update`, `unmount`. Тип пропсов `CheckoutWidget` сохраняется внутри.

**Стриминг пропсов через DOM.** Когда хост ре-рендерится с новыми пропсами, нужно как-то доставить их в смонтированный ремоут. Вариантов несколько: shared store, context, глобальные события. Я выбрал `CustomEvent` на самом DOM-элементе монтирования — это изолирует каждый слот, не требует shared module graph и работает даже когда хост и ремоут используют разные версии React.

**Компонент на стороне хоста.** Хост просто рендерит `MFBridgeLazy`:

```tsx
import { MFBridgeLazy } from '@mf-toolkit/mf-bridge'

<MFBridgeLazy
  register={() => import('checkout/entry').then(m => m.register)}
  props={{ orderId, userId }}
  fallback={<CheckoutSkeleton />}
  onError={(err) => reportError(err)}
/>
```

`props` здесь типизированы — TypeScript выводит их из `register`. Если ремоут добавил обязательный проп, хост не скомпилируется. Всё остальное — lazy-загрузка, маунт, передача обновлений, очистка при анмаунте — компонент берёт на себя.

## Как это выглядит в итоге

Те же пять слотов на странице — пять компонентов `<MFBridgeLazy>`. Никакого boilerplate, никакого `as any`. Ремоут обновился, поменял сигнатуру пропсов — хост узнаёт об этом от TypeScript, а не из Sentry в продакшне.

Пакет без продакшн-зависимостей. Стриминг пропсов через нативный `CustomEvent` API, React 18–20 как peer dep.

---

Выложил на npm: [@mf-toolkit/mf-bridge](https://www.npmjs.com/package/@mf-toolkit/mf-bridge)

Репозиторий с документацией и примерами: [github.com/zvitaly7/mf-toolkit](https://github.com/zvitaly7/mf-toolkit)

Если работаете с Module Federation и узнали в этом описании свой проект — посмотрите. Буду рад фидбеку.
