// Type definitions for Next.js routes

/**
 * Internal types used by the Next.js router and Link component.
 * These types are not meant to be used directly.
 * @internal
 */
declare namespace __next_route_internal_types__ {
  type SearchOrHash = `?${string}` | `#${string}`
  type WithProtocol = `${string}:${string}`

  type Suffix = '' | SearchOrHash

  type SafeSlug<S extends string> = S extends `${string}/${string}`
    ? never
    : S extends `${string}${SearchOrHash}`
    ? never
    : S extends ''
    ? never
    : S

  type CatchAllSlug<S extends string> = S extends `${string}${SearchOrHash}`
    ? never
    : S extends ''
    ? never
    : S

  type OptionalCatchAllSlug<S extends string> =
    S extends `${string}${SearchOrHash}` ? never : S

  type StaticRoutes = 
    | `/`
    | `/assistant`
    | `/api/assistant`
    | `/api/client-manager/data`
    | `/api/client-manager/documents`
    | `/api/client-manager/events`
    | `/api/client-manager/sync`
    | `/api/invoice-settings`
    | `/api/database`
    | `/api/invoices/clients`
    | `/api/invoices/pdf`
    | `/api/knowledge/jobs`
    | `/api/knowledge/reviews`
    | `/api/knowledge/reviews/import`
    | `/api/knowledge/query`
    | `/api/knowledge/overview`
    | `/api/knowledge/search`
    | `/api/knowledge/uploads`
    | `/api/materials`
    | `/api/materials/data`
    | `/api/materials/purchase-lists`
    | `/api/materials/stock`
    | `/api/materials/sync`
    | `/api/results/data`
    | `/api/results/options`
    | `/api/results/sync`
    | `/api/results/upload`
    | `/api/operations/summary`
    | `/clients`
    | `/finance`
    | `/finance/invoices/new`
    | `/lab-book`
    | `/knowledge`
    | `/materials`
    | `/providers`
    | `/settings`
    | `/settings/equipment`
    | `/results`
  type DynamicRoutes<T extends string = string> = 
    | `/api/client-manager/documents/${SafeSlug<T>}`
    | `/api/knowledge/jobs/${SafeSlug<T>}`
    | `/api/knowledge/jobs/${SafeSlug<T>}/step`
    | `/api/knowledge/reviews/${SafeSlug<T>}`
    | `/api/knowledge/reviews/${SafeSlug<T>}/source`
    | `/api/knowledge/sources/${SafeSlug<T>}`
    | `/api/knowledge/sources/${SafeSlug<T>}/content`
    | `/api/materials/${SafeSlug<T>}`
    | `/api/materials/purchase-lists/${SafeSlug<T>}`
    | `/api/materials/purchase-lists/${SafeSlug<T>}/export`
    | `/api/operations/${SafeSlug<T>}`
    | `/backend-api/${OptionalCatchAllSlug<T>}`

  type RouteImpl<T> = 
    | StaticRoutes
    | SearchOrHash
    | WithProtocol
    | `${StaticRoutes}${SearchOrHash}`
    | (T extends `${DynamicRoutes<infer _>}${Suffix}` ? T : never)
    
}

declare module 'next' {
  export { default } from 'next/types/index.js'
  export * from 'next/types/index.js'

  export type Route<T extends string = string> =
    __next_route_internal_types__.RouteImpl<T>
}

declare module 'next/link' {
  import type { LinkProps as OriginalLinkProps } from 'next/dist/client/link.js'
  import type { AnchorHTMLAttributes, DetailedHTMLProps } from 'react'
  import type { UrlObject } from 'url'

  type LinkRestProps = Omit<
    Omit<
      DetailedHTMLProps<
        AnchorHTMLAttributes<HTMLAnchorElement>,
        HTMLAnchorElement
      >,
      keyof OriginalLinkProps
    > &
      OriginalLinkProps,
    'href'
  >

  export type LinkProps<RouteInferType> = LinkRestProps & {
    /**
     * The path or URL to navigate to. This is the only required prop. It can also be an object.
     * @see https://nextjs.org/docs/api-reference/next/link
     */
    href: __next_route_internal_types__.RouteImpl<RouteInferType> | UrlObject
  }

  export default function Link<RouteType>(props: LinkProps<RouteType>): JSX.Element
}

declare module 'next/navigation' {
  export * from 'next/dist/client/components/navigation.js'

  import type { NavigateOptions, AppRouterInstance as OriginalAppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime.js'
  interface AppRouterInstance extends OriginalAppRouterInstance {
    /**
     * Navigate to the provided href.
     * Pushes a new history entry.
     */
    push<RouteType>(href: __next_route_internal_types__.RouteImpl<RouteType>, options?: NavigateOptions): void
    /**
     * Navigate to the provided href.
     * Replaces the current history entry.
     */
    replace<RouteType>(href: __next_route_internal_types__.RouteImpl<RouteType>, options?: NavigateOptions): void
    /**
     * Prefetch the provided href.
     */
    prefetch<RouteType>(href: __next_route_internal_types__.RouteImpl<RouteType>): void
  }

  export declare function useRouter(): AppRouterInstance;
}
