export interface QuoteContactSettings {
  supportEmail: string;
  quoteEmail: string;
  organizationName: string;
  serviceName: string;
  locationName: string;
  addressLines: string[];
  phone: string;
  paymentInstructions: string;
  costCentreAccount: string;
  collectionLocation: string;
}

const envString = (key: string) => {
  const value = import.meta.env[key];
  return typeof value === 'string' ? value.trim() : '';
};

export const quoteContactSettings: QuoteContactSettings = {
  supportEmail: envString('VITE_SUPPORT_EMAIL'),
  quoteEmail: envString('VITE_QUOTE_EMAIL') || envString('VITE_SUPPORT_EMAIL'),
  organizationName: envString('VITE_QUOTE_ORGANIZATION_NAME'),
  serviceName: envString('VITE_QUOTE_SERVICE_NAME') || '3D Printing Services',
  locationName: envString('VITE_QUOTE_LOCATION_NAME'),
  addressLines: envString('VITE_QUOTE_ADDRESS_LINES')
    .split(/\s*\|\s*/)
    .map((line) => line.trim())
    .filter(Boolean),
  phone: envString('VITE_QUOTE_PHONE'),
  paymentInstructions: envString('VITE_QUOTE_PAYMENT_INSTRUCTIONS'),
  costCentreAccount: envString('VITE_QUOTE_COST_CENTRE_ACCOUNT'),
  collectionLocation: envString('VITE_QUOTE_COLLECTION_LOCATION')
};
