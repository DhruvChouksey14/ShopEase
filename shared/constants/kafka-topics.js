/**
 * Centralized Kafka topic definitions.
 * Every service imports from here so topic names stay in sync.
 */
const KAFKA_TOPICS = {
     // Notification topics (user-service -> notification-service)
     OTP_EMAIL: 'notification.otp-email',
     WELCOME_EMAIL: 'notification.welcome-email',

     // Catalog topics (catalog-service -> search-service, inventory-service)
     PRODUCT_CREATED: 'catalog.product-created',
     PRODUCT_UPDATED: 'catalog.product-updated',
     PRODUCT_DELETED: 'catalog.product-deleted',
     CATEGORY_CREATED: 'catalog.category-created',
     CATEGORY_UPDATED: 'catalog.category-updated',

     // Inventory topics (inventory-service -> search-service)
     STOCK_UPDATED: 'inventory.stock-updated',

     // Order topics (order-service -> notification-service, search-service)
     ORDER_CONFIRMED: 'order.confirmed',
     ORDER_CANCELLED: 'order.cancelled',
     ORDER_FAILED: 'order.failed',
     ORDER_SHIPPED: 'order.shipped',
     ORDER_DELIVERED: 'order.delivered',

     // Payment topics (payment-service -> order-service)
     PAYMENT_SUCCESS: 'payment.success',
     PAYMENT_FAILED: 'payment.failed',

     // Dead-letter queues (per service — poison messages land here)
     DLQ_ORDER: 'dlq.order-service',
     DLQ_INVENTORY: 'dlq.inventory-service',
     DLQ_SEARCH: 'dlq.search-service',
     DLQ_NOTIFICATION: 'dlq.notification-service',
};

/**
 * Max retries before a consumer message is sent to the DLQ.
 * After this many failures the message is considered poison.
 */
const DLQ_MAX_RETRIES = 3;

module.exports = { KAFKA_TOPICS, DLQ_MAX_RETRIES };
