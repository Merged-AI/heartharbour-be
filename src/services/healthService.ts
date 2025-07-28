export interface HealthStatus {
  status: 'ok' | 'error';
  timestamp: string;
  environment?: {
    supabaseUrl: boolean;
    supabaseServiceKey: boolean;
    stripeSecretKey: boolean;
    stripeWebhookSecret: boolean;
    stripePublishableKey: boolean;
  };
  missing?: string[];
}

export class HealthService {
  getBasicHealth(): HealthStatus {
    return {
      status: 'ok',
      timestamp: new Date().toISOString()
    };
  }

  async getDetailedHealth(): Promise<HealthStatus> {
    const health: HealthStatus = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      environment: {
        supabaseUrl: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
        supabaseServiceKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
        stripeSecretKey: !!process.env.STRIPE_SECRET_KEY,
        stripeWebhookSecret: !!process.env.STRIPE_WEBHOOK_SECRET,
        stripePublishableKey: !!process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
      },
      missing: []
    };

    // Check for missing critical environment variables
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      health.missing!.push('SUPABASE_SERVICE_ROLE_KEY');
      health.status = 'error';
    }
    
    if (!process.env.STRIPE_WEBHOOK_SECRET) {
      health.missing!.push('STRIPE_WEBHOOK_SECRET');
      health.status = 'error';
    }

    if (!process.env.STRIPE_SECRET_KEY) {
      health.missing!.push('STRIPE_SECRET_KEY');
      health.status = 'error';
    }

    return health;
  }
} 