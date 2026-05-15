/**
 * Helpers for turning Shoptet's verbose JSON into compact, analytics-friendly
 * shapes. Shoptet endpoints typically wrap results in
 *   { data: { <collection>: [...], paginator: {...} } }
 *
 * These helpers project only the fields the LLM is likely to use, keeping
 * tool outputs small enough to fit useful context.
 */

import { parseNumber } from "../util.js";

export interface SlimOrder {
  code: string;
  creationTime?: string;
  status?: string;
  statusId?: number;
  paid?: boolean;
  email?: string;
  customerGuid?: string;
  source?: string;
  paymentMethod?: string;
  shippingMethod?: string;
  currency?: string;
  priceWithVat: number;
  priceWithoutVat: number;
}

export function slimOrder(raw: any): SlimOrder {
  return {
    code: raw?.code,
    creationTime: raw?.creationTime,
    status: raw?.status,
    statusId: raw?.statusId,
    paid: raw?.paid,
    email: raw?.email,
    customerGuid: raw?.customerGuid,
    source: raw?.source,
    paymentMethod: raw?.paymentMethod?.title ?? raw?.paymentMethod?.name ?? raw?.paymentMethodName,
    shippingMethod: raw?.shippingMethod?.title ?? raw?.shippingMethod?.name ?? raw?.shippingName,
    currency: raw?.priceElements?.currencyCode ?? raw?.currencyCode ?? raw?.currency,
    priceWithVat: parseNumber(
      raw?.priceElements?.toPay ??
        raw?.priceWithVat ??
        raw?.priceToPay ??
        raw?.price ??
        0,
    ),
    priceWithoutVat: parseNumber(raw?.priceWithoutVat ?? raw?.priceElements?.priceWithoutVat ?? 0),
  };
}

export interface SlimProduct {
  code?: string;
  guid?: string;
  name?: string;
  brand?: string;
  visibility?: string;
  type?: string;
  defaultCategoryGuid?: string;
  defaultCategoryName?: string;
  price?: number;
  priceWithVat?: number;
  vatRate?: number;
  currency?: string;
  stockAmount?: number;
  unit?: string;
  availability?: string;
}

export function slimProduct(raw: any): SlimProduct {
  const def = raw?.defaultPrice ?? raw?.price ?? {};
  return {
    code: raw?.code,
    guid: raw?.guid,
    name: raw?.name,
    brand: raw?.brand?.name ?? raw?.brandName,
    visibility: raw?.visibility,
    type: raw?.type,
    defaultCategoryGuid: raw?.defaultCategory?.guid ?? raw?.defaultCategoryGuid,
    defaultCategoryName: raw?.defaultCategory?.name,
    price: parseNumber(def?.price ?? def?.toPay ?? raw?.price),
    priceWithVat: parseNumber(def?.priceWithVat ?? def?.toPay),
    vatRate: parseNumber(def?.vatRate),
    currency: def?.currencyCode ?? raw?.currencyCode,
    stockAmount: raw?.stockAmount,
    unit: raw?.unit,
    availability: raw?.availability?.name ?? raw?.availability,
  };
}

export interface SlimCustomer {
  guid?: string;
  email?: string;
  phone?: string;
  fullName?: string;
  company?: string;
  group?: string;
  registered?: string;
  newsletter?: boolean;
}

export function slimCustomer(raw: any): SlimCustomer {
  const billing = raw?.billingAddress ?? {};
  const fullName =
    raw?.fullName ??
    ([billing?.firstName, billing?.lastName].filter(Boolean).join(" ") || undefined);
  return {
    guid: raw?.guid,
    email: raw?.email,
    phone: raw?.phone ?? billing?.phone,
    fullName,
    company: billing?.company,
    group: raw?.group?.name ?? raw?.customerGroup,
    registered: raw?.creationTime ?? raw?.registered,
    newsletter: raw?.newsletter,
  };
}

export interface SlimInvoice {
  code: string;
  orderCode?: string;
  creationTime?: string;
  taxDate?: string;
  dueDate?: string;
  isValid?: boolean;
  isPaid?: boolean;
  currency?: string;
  priceWithVat: number;
  priceWithoutVat: number;
}

export function slimInvoice(raw: any): SlimInvoice {
  const p = raw?.priceElements ?? raw?.price ?? {};
  return {
    code: raw?.code,
    orderCode: raw?.orderCode,
    creationTime: raw?.creationTime,
    taxDate: raw?.taxDate,
    dueDate: raw?.dueDate,
    isValid: raw?.isValid,
    isPaid: raw?.isPaid ?? raw?.paid,
    currency: p?.currencyCode ?? raw?.currencyCode,
    priceWithVat: parseNumber(p?.toPay ?? p?.priceWithVat ?? raw?.priceWithVat),
    priceWithoutVat: parseNumber(p?.priceWithoutVat ?? raw?.priceWithoutVat),
  };
}

export function asJsonContent(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
      },
    ],
  };
}
