import crypto from 'crypto';
import { z } from 'zod';

// Robokassa configuration
const ROBOKASSA_CONFIG = {
  merchantLogin: process.env.ROBOKASSA_MERCHANT_LOGIN!,
  password1: process.env.ROBOKASSA_PASSWORD1!, // For generating payment links
  password2: process.env.ROBOKASSA_PASSWORD2!, // For receiving results
  testMode: process.env.NODE_ENV !== 'production',
  baseUrl: process.env.NODE_ENV === 'production' 
    ? 'https://auth.robokassa.ru/Merchant/Index.aspx'
    : 'https://auth.robokassa.ru/Merchant/Index.aspx',
  apiUrl: 'https://auth.robokassa.ru/Merchant/WebService/Service.asmx'
};

// Validation schemas
const CreatePaymentSchema = z.object({
  amount: z.number().positive(),
  description: z.string(),
  userId: z.string(),
  planType: z.enum(['pro', 'ultra']),
  recurringInterval: z.enum(['monthly', 'yearly']).optional(),
  isRecurring: z.boolean().default(false),
  successUrl: z.string().url().optional(),
  failUrl: z.string().url().optional(),
});

const WebhookDataSchema = z.object({
  OutSum: z.string(),
  InvId: z.string(),
  SignatureValue: z.string(),
  PaymentMethod: z.string().optional(),
  IncCurrLabel: z.string().optional(),
  Shp_UserId: z.string().optional(),
  Shp_PlanType: z.string().optional(),
  Shp_IsRecurring: z.string().optional(),
});

export type CreatePaymentInput = z.infer<typeof CreatePaymentSchema>;
export type WebhookData = z.infer<typeof WebhookDataSchema>;

/**
 * Robokassa API client for handling payments and subscriptions
 */
export class RobokassaClient {
  private merchantLogin: string;
  private password1: string;
  private password2: string;
  private testMode: boolean;
  private baseUrl: string;

  constructor() {
    this.merchantLogin = ROBOKASSA_CONFIG.merchantLogin;
    this.password1 = ROBOKASSA_CONFIG.password1;
    this.password2 = ROBOKASSA_CONFIG.password2;
    this.testMode = ROBOKASSA_CONFIG.testMode;
    this.baseUrl = ROBOKASSA_CONFIG.baseUrl;
  }

  /**
   * Generate MD5 signature for Robokassa
   */
  private generateSignature(data: string): string {
    return crypto.createHash('md5').update(data).digest('hex');
  }

  /**
   * Create payment link for one-time or recurring payment
   */
  async createPayment(input: CreatePaymentInput): Promise<{
    paymentUrl: string;
    invoiceId: string;
  }> {
    const validated = CreatePaymentSchema.parse(input);
    
    // Generate unique invoice ID
    const invoiceId = `${Date.now()}_${validated.userId}_${validated.planType}`;
    
    // Convert amount to string with 2 decimal places
    const amountStr = (validated.amount / 100).toFixed(2);
    
    // Prepare custom parameters
    const customParams = {
      Shp_UserId: validated.userId,
      Shp_PlanType: validated.planType,
      Shp_IsRecurring: validated.isRecurring ? '1' : '0',
    };
    
    // Create signature string
    const signatureString = [
      this.merchantLogin,
      amountStr,
      invoiceId,
      this.password1,
      ...Object.entries(customParams).map(([key, value]) => `${key}=${value}`)
    ].join(':');
    
    const signature = this.generateSignature(signatureString);
    
    // Build payment URL
    const params = new URLSearchParams({
      MerchantLogin: this.merchantLogin,
      OutSum: amountStr,
      InvId: invoiceId,
      Description: validated.description,
      SignatureValue: signature,
      IsTest: this.testMode ? '1' : '0',
      ...customParams,
    });
    
    if (validated.successUrl) {
      params.append('SuccessURL', validated.successUrl);
    }
    
    if (validated.failUrl) {
      params.append('FailURL', validated.failUrl);
    }
    
    // Add recurring parameters if needed
    if (validated.isRecurring && validated.recurringInterval) {
      params.append('Recurring', 'true');
      // Set recurring period based on interval
      const period = validated.recurringInterval === 'monthly' ? '1M' : '1Y';
      params.append('RecurringPeriod', period);
    }
    
    const paymentUrl = `${this.baseUrl}?${params.toString()}`;
    
    return {
      paymentUrl,
      invoiceId,
    };
  }

  /**
   * Verify webhook signature
   */
  verifyWebhookSignature(data: WebhookData): boolean {
    try {
      const validated = WebhookDataSchema.parse(data);
      
      // Create signature string for verification
      const signatureString = [
        validated.OutSum,
        validated.InvId,
        this.password2
      ].join(':');
      
      const expectedSignature = this.generateSignature(signatureString).toUpperCase();
      const receivedSignature = validated.SignatureValue.toUpperCase();
      
      return expectedSignature === receivedSignature;
    } catch (error) {
      console.error('Error verifying webhook signature:', error);
      return false;
    }
  }

  /**
   * Process successful payment webhook
   */
  async processPaymentSuccess(data: WebhookData): Promise<{
    userId: string;
    planType: string;
    amount: number;
    invoiceId: string;
    isRecurring: boolean;
  }> {
    const validated = WebhookDataSchema.parse(data);
    
    if (!this.verifyWebhookSignature(validated)) {
      throw new Error('Invalid webhook signature');
    }
    
    return {
      userId: validated.Shp_UserId || '',
      planType: validated.Shp_PlanType || 'pro',
      amount: Math.round(parseFloat(validated.OutSum) * 100), // Convert to kopecks
      invoiceId: validated.InvId,
      isRecurring: validated.Shp_IsRecurring === '1',
    };
  }

  /**
   * Cancel recurring payment
   */
  async cancelRecurringPayment(recurringId: string): Promise<boolean> {
    try {
      // Note: Robokassa API for canceling recurring payments
      // This would require additional API implementation
      // For now, we'll handle cancellation through status updates
      console.log(`Canceling recurring payment: ${recurringId}`);
      return true;
    } catch (error) {
      console.error('Error canceling recurring payment:', error);
      return false;
    }
  }

  /**
   * Get payment status from Robokassa
   */
  async getPaymentStatus(invoiceId: string): Promise<{
    status: 'pending' | 'success' | 'failed' | 'canceled';
    amount?: number;
    paymentMethod?: string;
  }> {
    try {
      // Note: This would require Robokassa API integration
      // For now, return pending status
      return {
        status: 'pending'
      };
    } catch (error) {
      console.error('Error getting payment status:', error);
      return {
        status: 'failed'
      };
    }
  }
}

// Export singleton instance
export const robokassaClient = new RobokassaClient();