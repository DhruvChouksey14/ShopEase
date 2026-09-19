const { config } = require('../config');

const BRAND = 'ShopEase';
const ACCENT = '#4A3AFF';

const shell = (title, bodyHtml) => `
  <div style="font-family: Arial, sans-serif; max-width: 480px; margin: auto; padding: 24px; border: 1px solid #e5e5e5; border-radius: 10px; background: #ffffff; box-shadow: 0 4px 10px rgba(0,0,0,0.05);">
    <div style="text-align: center; margin-bottom: 20px;">
      <h2 style="color: #1e293b; margin: 0;">${BRAND}</h2>
    </div>
    ${bodyHtml}
    <hr style="border: none; border-top: 1px solid #eee; margin: 25px 0;" />
    <p style="font-size: 13px; color: #888; text-align: center;">
      Team ${BRAND}
    </p>
  </div>
`;

function getOtpTemplate(otp, ttlMinutes) {
     return shell('Verify your email', `
      <p style="font-size: 16px; color: #333;">Hi,</p>
      <p style="font-size: 16px; color: #333;">Welcome to <strong>${BRAND}</strong> 👋 Use the verification code below to complete your sign up:</p>
      <div style="text-align: center; margin: 30px 0;">
        <div style="display: inline-block; padding: 14px 26px; font-size: 32px; letter-spacing: 8px; font-weight: bold; background: #F4F4FF; border-radius: 8px; color: ${ACCENT}; border: 1px solid #e0e0ff;">
          ${otp}
        </div>
      </div>
      <p style="font-size: 15px; color: #555;">This code will expire in <strong>${ttlMinutes} minutes</strong>.</p>
      <p style="font-size: 15px; color: #555;">If this wasn't you, please ignore this email.</p>
    `);
}

function getWelcomeTemplate(firstName) {
     return shell('Welcome', `
      <p style="font-size: 16px; color: #333;">Hi <strong>${firstName}</strong>,</p>
      <p style="font-size: 16px; color: #333;">Welcome to <strong>${BRAND}</strong> 👋 Your account has been successfully created and verified.</p>
      <div style="text-align: center; margin: 25px 0;">
        <a href="${config.FRONTEND_URL}/products" style="display: inline-block; padding: 12px 22px; background: ${ACCENT}; color: white; font-size: 16px; font-weight: bold; text-decoration: none; border-radius: 6px;">
          Start Shopping
        </a>
      </div>
    `);
}

function itemsTable(items) {
     const rows = items.map((i) => `
      <tr>
        <td style="padding: 8px 0; font-size: 14px; color: #333;">${i.name} × ${i.quantity}</td>
        <td style="padding: 8px 0; font-size: 14px; color: #333; text-align: right;">₹${(i.price * i.quantity).toFixed(2)}</td>
      </tr>
     `).join('');
     return `<table style="width: 100%; border-collapse: collapse; margin: 15px 0;">${rows}</table>`;
}

function getOrderConfirmedTemplate({ firstName, orderId, items, totalAmount, shippingAddress }) {
     return shell('Order Confirmed', `
      <p style="font-size: 16px; color: #333;">Hi ${firstName ? `<strong>${firstName}</strong>` : 'there'},</p>
      <p style="font-size: 16px; color: #333;">Your order has been confirmed! Here's a summary:</p>
      <div style="background: #F4F4FF; padding: 15px; border-radius: 8px; margin: 20px 0;">
        <p style="margin: 5px 0; font-size: 14px;"><strong>Order ID:</strong> ${orderId}</p>
        ${itemsTable(items)}
        <p style="margin: 10px 0 0; font-size: 16px; text-align: right;"><strong>Total: ₹${totalAmount.toFixed(2)}</strong></p>
      </div>
      ${shippingAddress ? `<p style="font-size: 14px; color: #555;"><strong>Shipping to:</strong> ${shippingAddress.line1}, ${shippingAddress.city}, ${shippingAddress.postalCode}, ${shippingAddress.country}</p>` : ''}
      <p style="font-size: 15px; color: #555;">We'll email you again once your order ships. An invoice PDF is on its way separately.</p>
    `);
}

function getOrderFailedTemplate({ firstName, orderId, reason }) {
     const friendlyReason = { payment_failed: 'Your payment could not be processed', confirm_stock_failed: 'One or more items became unavailable', checkout_window_expired: 'The checkout window expired' }[reason] || 'An unexpected error occurred';
     return shell('Order Failed', `
      <p style="font-size: 16px; color: #333;">Hi ${firstName ? `<strong>${firstName}</strong>` : 'there'},</p>
      <p style="font-size: 16px; color: #333;">Unfortunately your order could not be completed.</p>
      <div style="background: #FEF2F2; padding: 15px; border-radius: 8px; margin: 20px 0;">
        <p style="margin: 5px 0; font-size: 14px;"><strong>Order ID:</strong> ${orderId}</p>
        <p style="margin: 5px 0; font-size: 14px;"><strong>Reason:</strong> ${friendlyReason}</p>
      </div>
      <p style="font-size: 15px; color: #555;">Any payment already captured will be automatically refunded within 5-7 business days. Please feel free to try again.</p>
    `);
}

function getOrderCancelledTemplate({ firstName, orderId, reason, refundAmount }) {
     const friendlyReason = { user_cancelled: 'You cancelled this order' }[reason] || reason;
     const refundLine = refundAmount > 0 ? `A refund of ₹${refundAmount.toFixed(2)} has been initiated and will reflect in 5-7 business days.` : 'No payment capture was refunded as none had completed.';
     return shell('Order Cancelled', `
      <p style="font-size: 16px; color: #333;">Hi ${firstName ? `<strong>${firstName}</strong>` : 'there'},</p>
      <p style="font-size: 16px; color: #333;">Your order has been cancelled successfully.</p>
      <div style="background: #F4F4FF; padding: 15px; border-radius: 8px; margin: 20px 0;">
        <p style="margin: 5px 0; font-size: 14px;"><strong>Order ID:</strong> ${orderId}</p>
        <p style="margin: 5px 0; font-size: 14px;"><strong>Reason:</strong> ${friendlyReason}</p>
      </div>
      <p style="font-size: 15px; color: #555;">${refundLine}</p>
    `);
}

function getOrderShippedTemplate({ firstName, orderId, trackingNumber }) {
     return shell('Order Shipped', `
      <p style="font-size: 16px; color: #333;">Hi ${firstName ? `<strong>${firstName}</strong>` : 'there'},</p>
      <p style="font-size: 16px; color: #333;">Good news — your order is on its way! 📦</p>
      <div style="background: #F4F4FF; padding: 15px; border-radius: 8px; margin: 20px 0;">
        <p style="margin: 5px 0; font-size: 14px;"><strong>Order ID:</strong> ${orderId}</p>
        ${trackingNumber ? `<p style="margin: 5px 0; font-size: 14px;"><strong>Tracking Number:</strong> ${trackingNumber}</p>` : ''}
      </div>
    `);
}

function getInvoiceEmailTemplate({ firstName, orderId, totalAmount }) {
     return shell('Your Invoice', `
      <p style="font-size: 16px; color: #333;">Hi ${firstName ? `<strong>${firstName}</strong>` : 'there'},</p>
      <p style="font-size: 16px; color: #333;">Please find attached the invoice for order <strong>${orderId}</strong> (total ₹${totalAmount.toFixed(2)}).</p>
      <p style="font-size: 15px; color: #555;">Thanks for shopping with us!</p>
    `);
}

module.exports = {
     getOtpTemplate,
     getWelcomeTemplate,
     getOrderConfirmedTemplate,
     getOrderFailedTemplate,
     getOrderCancelledTemplate,
     getOrderShippedTemplate,
     getInvoiceEmailTemplate,
};
