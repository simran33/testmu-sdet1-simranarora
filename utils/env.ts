function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable ${name}. Add it to .env`);
  }
  return value;
}

export const env = {
  baseUrl: required('BASE_URL'),
  apiUrl: required('API_URL'),
  customer: {
    email: required('CUSTOMER_EMAIL'),
    password: required('CUSTOMER_PASSWORD'),
  },
  admin: {
    email: required('ADMIN_EMAIL'),
    password: required('ADMIN_PASSWORD'),
  },
};
