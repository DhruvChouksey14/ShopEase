const PDFDocument = require('pdfkit');

/**
 * Generates a real invoice PDF in-memory and returns it as a base64 string,
 * ready to be attached to an email (SendGrid attachments are base64).
 */
function generateInvoicePdf({ orderId, items, totalAmount, shippingAddress, confirmedAt }) {
     return new Promise((resolve, reject) => {
          try {
               const doc = new PDFDocument({ margin: 50 });
               const chunks = [];
               doc.on('data', (chunk) => chunks.push(chunk));
               doc.on('end', () => resolve(Buffer.concat(chunks).toString('base64')));
               doc.on('error', reject);

               doc.fontSize(22).fillColor('#4A3AFF').text('ShopEase', { align: 'left' });
               doc.moveDown(0.3);
               doc.fontSize(16).fillColor('#111').text('Invoice', { align: 'left' });
               doc.moveDown(1);

               doc.fontSize(10).fillColor('#444');
               doc.text(`Order ID: ${orderId}`);
               doc.text(`Date: ${new Date(confirmedAt || Date.now()).toLocaleString()}`);
               if (shippingAddress) {
                    doc.moveDown(0.5);
                    doc.text('Ship To:');
                    doc.text(`${shippingAddress.line1}${shippingAddress.line2 ? ', ' + shippingAddress.line2 : ''}`);
                    doc.text(`${shippingAddress.city}, ${shippingAddress.state || ''} ${shippingAddress.postalCode}`);
                    doc.text(shippingAddress.country);
               }
               doc.moveDown(1.5);

               // Table header
               const tableTop = doc.y;
               doc.fontSize(11).fillColor('#000');
               doc.text('Item', 50, tableTop, { width: 220 });
               doc.text('Qty', 280, tableTop, { width: 60, align: 'right' });
               doc.text('Price', 350, tableTop, { width: 80, align: 'right' });
               doc.text('Total', 440, tableTop, { width: 80, align: 'right' });
               doc.moveTo(50, tableTop + 18).lineTo(520, tableTop + 18).strokeColor('#ccc').stroke();

               let y = tableTop + 26;
               doc.fontSize(10).fillColor('#333');
               for (const item of items) {
                    const lineTotal = (item.price * item.quantity).toFixed(2);
                    doc.text(item.name, 50, y, { width: 220 });
                    doc.text(String(item.quantity), 280, y, { width: 60, align: 'right' });
                    doc.text(`₹${item.price.toFixed(2)}`, 350, y, { width: 80, align: 'right' });
                    doc.text(`₹${lineTotal}`, 440, y, { width: 80, align: 'right' });
                    y += 20;
               }

               doc.moveTo(50, y + 5).lineTo(520, y + 5).strokeColor('#ccc').stroke();
               doc.fontSize(12).fillColor('#000').text(`Total: ₹${totalAmount.toFixed(2)}`, 350, y + 15, { width: 170, align: 'right' });

               doc.moveDown(4);
               doc.fontSize(9).fillColor('#999').text('Thank you for shopping with ShopEase.', 50, doc.y, { align: 'center', width: 470 });

               doc.end();
          } catch (err) {
               reject(err);
          }
     });
}

module.exports = { generateInvoicePdf };
