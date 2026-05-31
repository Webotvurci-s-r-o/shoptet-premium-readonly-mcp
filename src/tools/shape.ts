/**
 * Slimmers that project Shoptet's verbose JSON down to analytics-friendly
 * shapes. Field paths here are based on what the real Premium API returns;
 * see scripts/discover.mjs for the source of truth.
 */

import { parseNumber } from "../util.js";

export interface SlimOrder {
  code: string;
  creationTime?: string;
  changeTime?: string;
  status?: string;
  statusId?: number;
  paid?: boolean | null;
  email?: string;
  fullName?: string;
  customerGuid?: string | null;
  source?: string;
  sourceId?: number;
  paymentMethod?: string;
  paymentMethodGuid?: string;
  shippingMethod?: string;
  shippingGuid?: string;
  currency?: string;
  priceWithVat: number;
  priceWithoutVat: number;
  toPay: number;
}

export function slimOrder(raw: any): SlimOrder {
  const p = raw?.price ?? {};
  return {
    code: raw?.code,
    creationTime: raw?.creationTime,
    changeTime: raw?.changeTime,
    status: raw?.status?.name,
    statusId: raw?.status?.id,
    paid: raw?.paid,
    email: raw?.email,
    fullName: raw?.fullName,
    customerGuid: raw?.customerGuid,
    source: raw?.source?.name,
    sourceId: raw?.source?.id,
    paymentMethod: raw?.paymentMethod?.name,
    paymentMethodGuid: raw?.paymentMethod?.guid,
    shippingMethod: raw?.shipping?.name,
    shippingGuid: raw?.shipping?.guid,
    currency: p?.currencyCode,
    priceWithVat: parseNumber(p?.withVat),
    priceWithoutVat: parseNumber(p?.withoutVat),
    toPay: parseNumber(p?.toPay),
  };
}

export interface SlimProduct {
  guid?: string;
  code?: string;
  name?: string;
  brand?: string;
  brandCode?: string;
  visibility?: string;
  type?: string;
  defaultCategoryGuid?: string;
  defaultCategoryName?: string;
  variantCount?: number;
  price?: number;
  vatRate?: number;
  currency?: string;
  stockAmount?: number;
  unit?: string;
  availability?: string;
  url?: string;
}

/**
 * Lists return product metadata only; variant-level data (code/price/stock)
 * is exposed via product detail. We pull the first variant when present.
 */
export function slimProduct(raw: any): SlimProduct {
  const variants = Array.isArray(raw?.variants) ? raw.variants : [];
  const v = variants[0] ?? {};
  return {
    guid: raw?.guid,
    code: v?.code,
    name: raw?.name,
    brand: raw?.brand?.name,
    brandCode: raw?.brand?.code,
    visibility: raw?.visibility,
    type: raw?.type,
    defaultCategoryGuid: raw?.defaultCategory?.guid,
    defaultCategoryName: raw?.defaultCategory?.name,
    variantCount: variants.length || undefined,
    price: v?.price !== undefined ? parseNumber(v.price) : undefined,
    vatRate: v?.vatRate !== undefined ? parseNumber(v.vatRate) : undefined,
    currency: v?.currencyCode,
    stockAmount: v?.stock !== undefined ? parseNumber(v.stock) : undefined,
    unit: v?.unit,
    availability: v?.availability?.name ?? v?.availabilityWhenSoldOut?.name,
    url: raw?.url,
  };
}

export interface SlimCustomer {
  guid?: string;
  fullName?: string;
  company?: string;
  registered?: string;
  changed?: string;
  adminUrl?: string;
  email?: string;
  phone?: string;
}

/**
 * Customer list responses are intentionally thin (no email/phone). Detail
 * endpoint returns contacts and billing/delivery addresses.
 */
export function slimCustomer(raw: any): SlimCustomer {
  const billing = raw?.billingAddress ?? {};
  return {
    guid: raw?.guid,
    fullName: raw?.billFullName || raw?.fullName,
    company: raw?.billCompany || billing?.company,
    registered: raw?.creationTime,
    changed: raw?.changeTime,
    adminUrl: raw?.adminUrl,
    email: raw?.email,
    phone: raw?.phone ?? billing?.phone,
  };
}

export interface SlimInvoice {
  code: string;
  orderCode?: string;
  creationTime?: string;
  taxDate?: string;
  dueDate?: string;
  varSymbol?: string | number;
  isValid?: boolean;
  paid?: boolean;
  fullName?: string;
  company?: string;
  currency?: string;
  priceWithVat: number;
  priceWithoutVat: number;
  toPay: number;
}

export function slimInvoice(raw: any): SlimInvoice {
  const p = raw?.price ?? {};
  return {
    code: raw?.code,
    orderCode: raw?.orderCode,
    creationTime: raw?.creationTime,
    taxDate: raw?.taxDate,
    dueDate: raw?.dueDate,
    varSymbol: raw?.varSymbol,
    isValid: raw?.isValid,
    paid: raw?.paid,
    fullName: raw?.billFullName,
    company: raw?.billCompany,
    currency: p?.currencyCode,
    priceWithVat: parseNumber(p?.withVat),
    priceWithoutVat: parseNumber(p?.withoutVat),
    toPay: parseNumber(p?.toPay),
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
