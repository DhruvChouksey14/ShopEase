const sgMail = require('@sendgrid/mail');
const { config } = require('../config');
const {
     getOtpTemplate,
     getWelcomeTemplate,
     getOrderConfirmedTemplate,
     getOrderFailedTemplate,
     getOrderCancelledTemplate,
     getOrderShippedTemplate,
     getInvoiceEmailTemplate,
} = require('../templates');

sgMail.setApiKey(config.SENDGRID_API_KEY);

class EmailService {
     constructor() {
          this.from = config.MAIL_SEND;
          this.maxRetries = 3;
     }

     async sendWithRetry(msg, retries = 0) {
          try {
               await sgMail.send(msg);
               console.log(`Email sent successfully to ${msg.to}`, { subject: msg.subject, attempt: retries + 1 });
               return { success: true };
          } catch (error) {
               console.error(`Email sending failed (attempt ${retries + 1}/${this.maxRetries})`, {
                    to: msg.to,
                    error: error.response?.body?.errors || error.message,
                    code: error.code,
               });

               if (retries < this.maxRetries - 1) {
                    const delay = Math.pow(2, retries) * 1000;
                    await new Promise((resolve) => setTimeout(resolve, delay));
                    return this.sendWithRetry(msg, retries + 1);
               }
               throw error;
          }
     }

     async sendOtpEmail(email, otp, ttlMinutes) {
          return this.sendWithRetry({ to: email, from: this.from, subject: 'Your ShopEase verification code', html: getOtpTemplate(otp, ttlMinutes) });
     }

     async sendWelcomeEmail(email, firstName) {
          return this.sendWithRetry({ to: email, from: this.from, subject: 'Welcome to ShopEase - Email Verified', html: getWelcomeTemplate(firstName) });
     }

     async sendOrderConfirmedEmail(email, orderData) {
          return this.sendWithRetry({ to: email, from: this.from, subject: `Order Confirmed - #${orderData.orderId.slice(0, 8)}`, html: getOrderConfirmedTemplate(orderData) });
     }

     async sendOrderFailedEmail(email, orderData) {
          return this.sendWithRetry({ to: email, from: this.from, subject: 'Order Unsuccessful - Please Try Again', html: getOrderFailedTemplate(orderData) });
     }

     async sendOrderCancelledEmail(email, orderData) {
          return this.sendWithRetry({ to: email, from: this.from, subject: 'Order Cancelled - Refund Update', html: getOrderCancelledTemplate(orderData) });
     }

     async sendOrderShippedEmail(email, orderData) {
          return this.sendWithRetry({ to: email, from: this.from, subject: `Your Order Has Shipped - #${orderData.orderId.slice(0, 8)}`, html: getOrderShippedTemplate(orderData) });
     }

     /**
      * Sends the invoice PDF (base64) as a real email attachment.
      * Called by the RabbitMQ consumer below, driven by worker-service's
      * PDF-generation job — attachments never travel through Kafka.
      */
     async sendInvoiceEmail(email, orderData, pdfBase64) {
          return this.sendWithRetry({
               to: email,
               from: this.from,
               subject: `Invoice for Order #${orderData.orderId.slice(0, 8)}`,
               html: getInvoiceEmailTemplate(orderData),
               attachments: [
                    {
                         content: pdfBase64,
                         filename: `invoice-${orderData.orderId.slice(0, 8)}.pdf`,
                         type: 'application/pdf',
                         disposition: 'attachment',
                    },
               ],
          });
     }
}

module.exports = new EmailService();
