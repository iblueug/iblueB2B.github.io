// ============================================
// SUPABASE CONFIGURATION
// ============================================
const SUPABASE_URL = 'https://uufhvmmgwzkxvvdbqemz.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV1Zmh2bW1nd3preHZ2ZGJxZW16Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAzMDIzNTYsImV4cCI6MjA4NTg3ODM1Nn0.WABHx4ilFRkhPHP-y4ZC4E8Kb7PRqY-cyxI8cVS8Tyc';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ============================================
// STATE MANAGEMENT
// ============================================
let currentUser = null;
let currentUserProfile = null;
let purchaseOrder = null;
let quote = null;
let inquiry = null;
let supplier = null;
let orderItems = [];

// Get PO ID from URL (can be order_id or quote_id with ?from=quote)
const urlParams = new URLSearchParams(window.location.search);
const poId = urlParams.get('id');
const fromQuote = urlParams.get('from') === 'quote';

// ============================================
// INITIALIZATION
//============================================
document.addEventListener('DOMContentLoaded', async () => {
    await checkAuth();
    
    if (!poId) {
        showError('No purchase order ID provided');
        return;
    }
    
    if (fromQuote) {
        await generatePOFromQuote(poId);
    } else {
        await loadPurchaseOrder(poId);
    }
    
    setupEventListeners();
    setupRealtimeSubscription();
});

// ============================================
// AUTHENTICATION
// ============================================
async function checkAuth() {
    try {
        const { data: { user } } = await sb.auth.getUser();
        if (!user) {
            window.location.href = 'login.html?redirect=purchase-order.html?id=' + poId + (fromQuote ? '&from=quote' : '');
            return;
        }
        currentUser = user;
        
        // Load user profile
        const { data: profile } = await sb
            .from('profiles')
            .select('*')
            .eq('id', user.id)
            .single();
            
        currentUserProfile = profile;
        
    } catch (error) {
        console.error('Error checking auth:', error);
        window.location.href = 'login.html';
    }
}

// ============================================
// GENERATE PO FROM QUOTE
// ============================================
async function generatePOFromQuote(quoteId) {
    showLoading(true);
    
    try {
        // Check if PO already exists for this quote
        const { data: existingPO, error: checkError } = await sb
            .from('orders')
            .select('*')
            .eq('original_quote_id', quoteId)
            .maybeSingle();
            
        if (existingPO) {
            // PO already exists, load it instead
            await loadPurchaseOrder(existingPO.id);
            return;
        }
        
        // Load quote with all related data
        const { data: quoteData, error: quoteError } = await sb
            .from('supplier_quotes')
            .select(`
                *,
                suppliers!inner (
                    id,
                    business_name,
                    verification_status,
                    business_registration,
                    tax_id,
                    profiles!suppliers_profile_id_fkey (
                        avatar_url,
                        location,
                        phone,
                        email,
                        full_name
                    )
                ),
                supplier_quote_items (*),
                inquiry_requests!inner (
                    id,
                    inquiry_number,
                    title,
                    buyer_id,
                    shipping_address,
                    shipping_district,
                    payment_terms,
                    delivery_terms,
                    inquiry_items (*)
                )
            `)
            .eq('id', quoteId)
            .single();
            
        if (quoteError) throw quoteError;
        
        // Verify this quote belongs to the current user
        if (quoteData.inquiry_requests.buyer_id !== currentUser.id) {
            showError('You do not have permission to create a PO from this quote');
            return;
        }
        
        quote = quoteData;
        inquiry = quote.inquiry_requests;
        supplier = quote.suppliers;
        orderItems = quote.supplier_quote_items || [];
        
        // Check if quote is already accepted
        if (quote.status !== 'accepted' && quote.status !== 'sent') {
            showError('This quote cannot be converted to a purchase order');
            return;
        }
        
        // If quote is sent (not yet accepted), we should accept it first
        if (quote.status === 'sent') {
            await acceptQuoteAndCreatePO();
            return;
        }
        
        // Quote is already accepted, create PO
        await createPurchaseOrder();
        
    } catch (error) {
        console.error('Error generating PO from quote:', error);
        showError('Failed to generate purchase order');
    } finally {
        showLoading(false);
    }
}

async function acceptQuoteAndCreatePO() {
    try {
        // Update quote status to accepted
        const { error: updateError } = await sb
            .from('supplier_quotes')
            .update({ status: 'accepted' })
            .eq('id', quote.id);
            
        if (updateError) throw updateError;
        
        quote.status = 'accepted';
        
        // Create purchase order
        await createPurchaseOrder();
        
        // Reject other quotes
        await sb
            .from('supplier_quotes')
            .update({ status: 'rejected' })
            .eq('inquiry_id', inquiry.id)
            .neq('id', quote.id)
            .eq('status', 'sent');
        
    } catch (error) {
        console.error('Error accepting quote:', error);
        throw error;
    }
}

async function createPurchaseOrder() {
    try {
        // Calculate totals
        const subtotal = orderItems.reduce((sum, item) => sum + (item.total_price || 0), 0);
        const vat = subtotal * 0.18; // 18% VAT
        const shipping = 0; // Could be from quote or separate calculation
        const total = subtotal + vat + shipping;
        
        // Generate PO number
        const poNumber = 'PO-' + new Date().getFullYear() + '-' + 
                        String(Math.floor(Math.random() * 10000)).padStart(4, '0');
        
        // Create order in database
        const { data: order, error: orderError } = await sb
            .from('orders')
            .insert({
                order_number: poNumber,
                buyer_id: currentUser.id,
                supplier_id: supplier.id,
                status: 'pending',
                subtotal: subtotal,
                tax_amount: vat,
                shipping_fee: shipping,
                total_amount: total,
                currency: 'UGX',
                payment_status: 'pending',
                payment_terms: quote.payment_terms || inquiry.payment_terms,
                delivery_terms: quote.delivery_terms || inquiry.delivery_terms,
                delivery_address: inquiry.shipping_address,
                delivery_district: inquiry.shipping_district,
                original_quote_id: quote.id,
                inquiry_id: inquiry.id,
                created_at: new Date().toISOString(),
                placed_at: new Date().toISOString()
            })
            .select()
            .single();
            
        if (orderError) throw orderError;
        
        purchaseOrder = order;
        
        // Create order items
        if (orderItems.length > 0) {
            const itemsToInsert = orderItems.map(item => ({
                order_id: order.id,
                ad_id: item.product_id,
                product_title: item.product_name,
                quantity: item.quantity,
                unit_price: item.unit_price,
                total_price: item.total_price,
                status: 'pending'
            }));
            
            const { error: itemsError } = await sb
                .from('order_items')
                .insert(itemsToInsert);
                
            if (itemsError) throw itemsError;
        }
        
        // Update inquiry status
        await sb
            .from('inquiry_requests')
            .update({ status: 'ordered' })
            .eq('id', inquiry.id);
        
        // Create notification for supplier
        await sb
            .from('notifications')
            .insert({
                user_id: supplier.id,
                type: 'order_received',
                title: 'New Order Received',
                message: `You've received a purchase order #${poNumber}`,
                link: `/supplier-order.html?id=${order.id}`,
                ad_id: null
            });
        
        // Load the complete order with items
        await loadPurchaseOrder(order.id);
        
        // Show success message
        document.getElementById('successMessage').textContent = 
            'Purchase order created successfully!';
        document.getElementById('successModal').classList.add('show');
        
    } catch (error) {
        console.error('Error creating purchase order:', error);
        throw error;
    }
}

// ============================================
// LOAD EXISTING PURCHASE ORDER
// ============================================
async function loadPurchaseOrder(orderId) {
    showLoading(true);
    
    try {
        // Load order with all related data
        const { data: order, error: orderError } = await sb
            .from('orders')
            .select(`
                *,
                order_items (*),
                suppliers!orders_supplier_id_fkey (
                    id,
                    business_name,
                    verification_status,
                    business_registration,
                    tax_id,
                    profiles!suppliers_profile_id_fkey (
                        avatar_url,
                        location,
                        phone,
                        email,
                        full_name
                    )
                ),
                inquiry_requests!orders_inquiry_id_fkey (
                    id,
                    inquiry_number,
                    title
                ),
                supplier_quotes!orders_original_quote_id_fkey (
                    id,
                    quote_number,
                    valid_until
                )
            `)
            .eq('id', orderId)
            .single();
            
        if (orderError) throw orderError;
        
        // Verify this order belongs to the current user
        if (order.buyer_id !== currentUser.id) {
            showError('You do not have permission to view this purchase order');
            return;
        }
        
        purchaseOrder = order;
        supplier = order.suppliers;
        inquiry = order.inquiry_requests;
        quote = order.supplier_quotes;
        orderItems = order.order_items || [];
        
        // Render all sections
        renderStatusBar();
        renderPOHeader();
        renderParties();
        renderReference();
        renderItemsTable();
        renderSummary();
        renderTerms();
        renderSignatures();
        renderActionButtons();
        
        // Show the content
        document.getElementById('poContent').style.display = 'block';
        
    } catch (error) {
        console.error('Error loading purchase order:', error);
        showError('Failed to load purchase order');
    } finally {
        showLoading(false);
    }
}

// ============================================
// RENDERING FUNCTIONS
//===========================================
function renderStatusBar() {
    const statusBar = document.getElementById('poStatusBar');
    const status = purchaseOrder.status;
    const paymentStatus = purchaseOrder.payment_status;
    
    let statusText = '';
    let statusClass = '';
    
    switch(status) {
        case 'pending':
            statusText = 'Pending Confirmation';
            statusClass = 'pending';
            break;
        case 'confirmed':
            statusText = 'Confirmed';
            statusClass = 'confirmed';
            break;
        case 'processing':
            statusText = 'Processing';
            statusClass = 'processing';
            break;
        case 'shipped':
            statusText = 'Shipped';
            statusClass = 'shipped';
            break;
        case 'delivered':
            statusText = 'Delivered';
            statusClass = 'delivered';
            break;
        case 'cancelled':
            statusText = 'Cancelled';
            statusClass = 'cancelled';
            break;
        default:
            statusText = status;
            statusClass = status;
    }
    
    // Timeline steps
    const steps = [
        { label: 'Order Placed', completed: true },
        { label: 'Confirmed', completed: status !== 'pending' },
        { label: 'Processing', completed: ['processing', 'shipped', 'delivered'].includes(status) },
        { label: 'Shipped', completed: ['shipped', 'delivered'].includes(status) },
        { label: 'Delivered', completed: status === 'delivered' }
    ];
    
    statusBar.innerHTML = `
        <span class="status-badge-large ${statusClass}">
            <i class="fas ${getStatusIcon(status)}"></i>
            ${statusText}
        </span>
        <span class="status-badge-large" style="background: var(--gray-200); color: var(--gray-700);">
            <i class="fas fa-credit-card"></i>
            Payment: ${paymentStatus}
        </span>
        <div class="po-timeline">
            ${steps.map((step, index) => `
                <div class="timeline-step ${step.completed ? 'completed' : ''} ${index === steps.findIndex(s => !s.completed) ? 'active' : ''}">
                    <div class="timeline-dot"></div>
                    <span>${step.label}</span>
                </div>
                ${index < steps.length - 1 ? '<i class="fas fa-chevron-right" style="color: var(--gray-300); font-size: 10px;"></i>' : ''}
            `).join('')}
        </div>
    `;
}

function renderPOHeader() {
    document.getElementById('poNumber').textContent = purchaseOrder.order_number;
    document.getElementById('poDate').textContent = `Issued: ${formatDate(purchaseOrder.created_at)}`;
}

function renderParties() {
    // Buyer info
    const buyerInfo = document.getElementById('buyerInfo');
    buyerInfo.innerHTML = `
        <div class="party-card">
            <div class="party-name">${escapeHtml(currentUserProfile?.business_name || currentUserProfile?.full_name || 'Buyer')}</div>
            <div class="party-detail">
                <i class="fas fa-map-marker-alt"></i>
                ${escapeHtml(purchaseOrder.delivery_address || '')}, ${escapeHtml(purchaseOrder.delivery_district || '')}
            </div>
            <div class="party-detail">
                <i class="fas fa-phone"></i>
                ${escapeHtml(currentUserProfile?.phone || 'Not provided')}
            </div>
            <div class="party-detail">
                <i class="fas fa-envelope"></i>
                ${escapeHtml(currentUserProfile?.email || currentUser.email)}
            </div>
            ${currentUserProfile?.tin_number ? `
                <div class="party-detail">
                    <i class="fas fa-id-card"></i>
                    TIN: ${currentUserProfile.tin_number}
                </div>
            ` : ''}
        </div>
    `;
    
    // Supplier info
    const supplierInfo = document.getElementById('supplierInfo');
    const supplierProfile = supplier?.profiles || {};
    
    supplierInfo.innerHTML = `
        <div class="party-card">
            <div class="party-name">${escapeHtml(supplier?.business_name || supplierProfile.full_name || 'Supplier')}</div>
            ${supplier?.verification_status === 'verified' ? `
                <div class="party-detail">
                    <i class="fas fa-check-circle" style="color: var(--secondary);"></i>
                    Verified Supplier
                </div>
            ` : ''}
            <div class="party-detail">
                <i class="fas fa-map-marker-alt"></i>
                ${escapeHtml(supplierProfile.location || 'Uganda')}
            </div>
            <div class="party-detail">
                <i class="fas fa-phone"></i>
                ${escapeHtml(supplierProfile.phone || 'Not provided')}
            </div>
            <div class="party-detail">
                <i class="fas fa-envelope"></i>
                ${escapeHtml(supplierProfile.email || '')}
            </div>
            ${supplier?.tax_id ? `
                <div class="party-detail">
                    <i class="fas fa-id-card"></i>
                    Tax ID: ${supplier.tax_id}
                </div>
            ` : ''}
        </div>
    `;
}

function renderReference() {
    document.getElementById('quoteNumber').textContent = quote?.quote_number || 'N/A';
    document.getElementById('quoteDate').textContent = quote ? formatDate(quote.created_at) : 'N/A';
    document.getElementById('inquiryNumber').textContent = inquiry?.inquiry_number || 'N/A';
    
    const paymentTerms = purchaseOrder.payment_terms ? 
        (Array.isArray(purchaseOrder.payment_terms) ? purchaseOrder.payment_terms[0] : purchaseOrder.payment_terms) : 
        'Not specified';
    document.getElementById('paymentTerms').textContent = formatPaymentTerms(paymentTerms);
    
    const deliveryTerms = purchaseOrder.delivery_terms ?
        (Array.isArray(purchaseOrder.delivery_terms) ? purchaseOrder.delivery_terms[0] : purchaseOrder.delivery_terms) :
        'Not specified';
    document.getElementById('deliveryTerms').textContent = formatDeliveryTerms(deliveryTerms);
    
    // Expected delivery date (could be from order or quote)
    const expectedDate = purchaseOrder.expected_delivery || 
                        (quote?.valid_until ? new Date(quote.valid_until) : null);
    document.getElementById('deliveryDate').textContent = expectedDate ? formatDate(expectedDate) : 'To be agreed';
}

function renderItemsTable() {
    const tbody = document.getElementById('itemsTableBody');
    const tfoot = document.getElementById('itemsTableFooter');
    
    if (orderItems.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center">No items in this order</td></tr>';
        return;
    }
    
    tbody.innerHTML = orderItems.map((item, index) => `
        <tr>
            <td>${index + 1}</td>
            <td>
                <span class="product-name">${escapeHtml(item.product_title || 'Product')}</span>
                ${item.product_sku ? `<span class="product-sku">SKU: ${item.product_sku}</span>` : ''}
            </td>
            <td>${item.product_sku || '—'}</td>
            <td class="text-right">${item.quantity || 0}</td>
            <td class="text-right">UGX ${formatNumber(item.unit_price)}</td>
            <td class="text-right">UGX ${formatNumber(item.total_price)}</td>
        </tr>
    `).join('');
    
    const subtotal = purchaseOrder.subtotal || orderItems.reduce((sum, item) => sum + (item.total_price || 0), 0);
    const vat = purchaseOrder.tax_amount || subtotal * 0.18;
    const shipping = purchaseOrder.shipping_fee || 0;
    const total = purchaseOrder.total_amount || subtotal + vat + shipping;
    
    tfoot.innerHTML = `
        <tr>
            <td colspan="5" class="text-right"><strong>Subtotal:</strong></td>
            <td class="text-right">UGX ${formatNumber(subtotal)}</td>
        </tr>
        <tr>
            <td colspan="5" class="text-right"><strong>VAT (18%):</strong></td>
            <td class="text-right">UGX ${formatNumber(vat)}</td>
        </tr>
        <tr>
            <td colspan="5" class="text-right"><strong>Shipping:</strong></td>
            <td class="text-right">UGX ${formatNumber(shipping)}</td>
        </tr>
    `;
}

function renderSummary() {
    const subtotal = purchaseOrder.subtotal || orderItems.reduce((sum, item) => sum + (item.total_price || 0), 0);
    const vat = purchaseOrder.tax_amount || subtotal * 0.18;
    const shipping = purchaseOrder.shipping_fee || 0;
    const total = purchaseOrder.total_amount || subtotal + vat + shipping;
    
    document.getElementById('subtotal').textContent = `UGX ${formatNumber(subtotal)}`;
    document.getElementById('vat').textContent = `UGX ${formatNumber(vat)}`;
    document.getElementById('shipping').textContent = `UGX ${formatNumber(shipping)}`;
    document.getElementById('totalAmount').textContent = `UGX ${formatNumber(total)}`;
}

function renderTerms() {
    // Terms are already in the static HTML, but we could customize based on order
    // This is handled in the static HTML for now
}

function renderSignatures() {
    // Buyer signature
    document.getElementById('buyerName').textContent = currentUserProfile?.business_name || currentUserProfile?.full_name || 'Buyer';
    document.getElementById('buyerDate').textContent = formatDate(new Date());
    
    // Supplier signature (only if order is confirmed)
    if (purchaseOrder.status !== 'pending') {
        document.getElementById('supplierName').textContent = supplier?.business_name || 'Supplier';
        document.getElementById('supplierDate').textContent = formatDate(purchaseOrder.updated_at || new Date());
    } else {
        document.getElementById('supplierSignature').innerHTML = '<i style="color: var(--gray-400);">Awaiting signature</i>';
        document.getElementById('supplierName').innerHTML = '—';
        document.getElementById('supplierDate').innerHTML = '—';
    }
}

function renderActionButtons() {
    const container = document.getElementById('actionButtons');
    const status = purchaseOrder.status;
    const paymentStatus = purchaseOrder.payment_status;
    
    if (status === 'cancelled') {
        container.innerHTML = `
            <button class="btn-large secondary" onclick="window.location.href='orders.html'">
                <i class="fas fa-arrow-left"></i> Back to Orders
            </button>
        `;
        return;
    }
    
    if (status === 'delivered') {
        container.innerHTML = `
            <button class="btn-large secondary" onclick="window.location.href='orders.html'">
                <i class="fas fa-arrow-left"></i> Back to Orders
            </button>
            <button class="btn-large primary" onclick="window.location.href='order-invoice.html?id=${purchaseOrder.id}'">
                <i class="fas fa-file-invoice"></i> View Invoice
            </button>
            <button class="btn-large success" onclick="window.location.href='order-review.html?id=${purchaseOrder.id}'">
                <i class="fas fa-star"></i> Leave Review
            </button>
        `;
        return;
    }
    
    // Active order
    let buttons = '';
    
    if (paymentStatus === 'pending') {
        buttons += `
            <button class="btn-large success" onclick="showPaymentModal()">
                <i class="fas fa-credit-card"></i> Make Payment
            </button>
        `;
    }
    
    if (status === 'pending') {
        buttons += `
            <button class="btn-large warning" onclick="showConfirmModal('confirm', 'Confirm Order', 'Are you sure you want to confirm this order?')">
                <i class="fas fa-check-circle"></i> Confirm Order
            </button>
            <button class="btn-large danger" onclick="showConfirmModal('cancel', 'Cancel Order', 'Are you sure you want to cancel this order?')">
                <i class="fas fa-times-circle"></i> Cancel Order
            </button>
        `;
    }
    
    buttons += `
        <button class="btn-large secondary" onclick="window.location.href='orders.html'">
            <i class="fas fa-arrow-left"></i> Back to Orders
        </button>
    `;
    
    container.innerHTML = buttons;
}

// ============================================
// ACTION FUNCTIONS
// ============================================
window.printPO = function() {
    window.print();
};

window.downloadPO = function() {
    const element = document.getElementById('poDocument');
    const opt = {
        margin: [0.5, 0.5, 0.5, 0.5],
        filename: `PO-${purchaseOrder.order_number}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2 },
        jsPDF: { unit: 'in', format: 'a4', orientation: 'portrait' }
    };
    
    html2pdf().set(opt).from(element).save();
};

window.emailPO = function() {
    // This would integrate with an email service
    showToast('Email functionality coming soon');
};

window.showPaymentModal = function() {
    showConfirmModal('payment', 'Make Payment', 'You will be redirected to the payment gateway to complete payment for this order.');
};

window.showConfirmModal = function(action, title, message) {
    const modal = document.getElementById('confirmModal');
    const modalTitle = document.getElementById('confirmModalTitle');
    const modalBody = document.getElementById('confirmModalBody');
    
    modalTitle.textContent = title;
    
    modalBody.innerHTML = `
        <div class="confirm-message">${message}</div>
        ${action === 'cancel' ? `
            <div class="confirm-warning">
                <i class="fas fa-exclamation-triangle"></i>
                This action cannot be undone
            </div>
        ` : ''}
        <div class="modal-actions">
            <button class="btn-confirm ${action === 'cancel' ? 'danger' : ''}" onclick="handleConfirmAction('${action}')">
                Confirm
            </button>
            <button class="btn-cancel" onclick="closeConfirmModal()">Cancel</button>
        </div>
    `;
    
    window.currentConfirmAction = action;
    modal.classList.add('show');
};

window.handleConfirmAction = async function(action) {
    closeConfirmModal();
    
    switch(action) {
        case 'confirm':
            await confirmOrder();
            break;
        case 'cancel':
            await cancelOrder();
            break;
        case 'payment':
            window.location.href = `payment-process.html?order=${purchaseOrder.id}`;
            break;
    }
};

async function confirmOrder() {
    try {
        const { error } = await sb
            .from('orders')
            .update({ 
                status: 'confirmed',
                confirmed_at: new Date().toISOString()
            })
            .eq('id', purchaseOrder.id);
            
        if (error) throw error;
        
        showToast('Order confirmed successfully');
        
        // Refresh data
        purchaseOrder.status = 'confirmed';
        renderStatusBar();
        renderActionButtons();
        
        // Notify supplier
        await sb
            .from('notifications')
            .insert({
                user_id: supplier.id,
                type: 'order_confirmed',
                title: 'Order Confirmed',
                message: `Order #${purchaseOrder.order_number} has been confirmed`,
                link: `/supplier-order.html?id=${purchaseOrder.id}`,
                ad_id: null
            });
        
    } catch (error) {
        console.error('Error confirming order:', error);
        showToast('Failed to confirm order');
    }
}

async function cancelOrder() {
    try {
        const { error } = await sb
            .from('orders')
            .update({ 
                status: 'cancelled',
                cancelled_at: new Date().toISOString()
            })
            .eq('id', purchaseOrder.id);
            
        if (error) throw error;
        
        showToast('Order cancelled');
        
        // Refresh data
        purchaseOrder.status = 'cancelled';
        renderStatusBar();
        renderActionButtons();
        
        // Notify supplier
        await sb
            .from('notifications')
            .insert({
                user_id: supplier.id,
                type: 'order_cancelled',
                title: 'Order Cancelled',
                message: `Order #${purchaseOrder.order_number} has been cancelled`,
                link: `/supplier-order.html?id=${purchaseOrder.id}`,
                ad_id: null
            });
        
    } catch (error) {
        console.error('Error cancelling order:', error);
        showToast('Failed to cancel order');
    }
}

// ============================================
// UTILITY FUNCTIONS
// ============================================
function showLoading(show) {
    const loadingEl = document.getElementById('loadingState');
    const contentEl = document.getElementById('poContent');
    const errorEl = document.getElementById('errorState');
    
    if (!loadingEl || !contentEl || !errorEl) return;
    
    if (show) {
        loadingEl.style.display = 'block';
        contentEl.style.display = 'none';
        errorEl.style.display = 'none';
    } else {
        loadingEl.style.display = 'none';
    }
}

function showError(message) {
    showLoading(false);
    document.getElementById('errorState').style.display = 'block';
    document.getElementById('poContent').style.display = 'none';
    if (message) showToast(message);
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatDate(dateString) {
    if (!dateString) return 'Not set';
    try {
        const date = new Date(dateString);
        return date.toLocaleDateString('en-UG', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    } catch (e) {
        return 'Invalid date';
    }
}

function formatNumber(num) {
    if (num === null || num === undefined) return '0';
    try {
        return num.toLocaleString('en-UG');
    } catch (e) {
        return num.toString();
    }
}

function formatPaymentTerms(term) {
    const terms = {
        'advance_full': '100% Advance',
        'advance_partial': '50% Advance, 50% on Delivery',
        'credit_7': '7 Days Net',
        'credit_15': '15 Days Net',
        'credit_30': '30 Days Net',
        'negotiable': 'Negotiable'
    };
    return terms[term] || term || 'Not specified';
}

function formatDeliveryTerms(term) {
    const terms = {
        'ex_warehouse': 'Ex-Warehouse',
        'fob': 'FOB (Free on Board)',
        'cif': 'CIF (Cost, Insurance, Freight)',
        'door_delivery': 'Door Delivery',
        'pickup': 'Buyer Pickup',
        'dap': 'DAP (Delivered at Place)'
    };
    return terms[term] || term || 'Not specified';
}

function getStatusIcon(status) {
    const icons = {
        'pending': 'fa-clock',
        'confirmed': 'fa-check-circle',
        'processing': 'fa-cog',
        'shipped': 'fa-truck',
        'delivered': 'fa-check-double',
        'cancelled': 'fa-times-circle'
    };
    return icons[status] || 'fa-file-invoice';
}

function showToast(message) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3000);
}

// ============================================
// MODAL CLOSE FUNCTIONS
// ============================================
window.closeConfirmModal = function() {
    document.getElementById('confirmModal').classList.remove('show');
};

window.closeSuccessModal = function() {
    document.getElementById('successModal').classList.remove('show');
};

// ============================================
// EVENT LISTENERS
// ============================================
function setupEventListeners() {
    // Close modals when clicking outside
    document.querySelectorAll('.modal').forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                closeConfirmModal();
                closeSuccessModal();
            }
        });
    });
}

// ============================================
// REALTIME SUBSCRIPTIONS
// ============================================
function setupRealtimeSubscription() {
    if (!purchaseOrder) return;
    
    // Listen for order status changes
    const orderSubscription = sb
        .channel('order-status-' + purchaseOrder.id)
        .on(
            'postgres_changes',
            {
                event: 'UPDATE',
                schema: 'public',
                table: 'orders',
                filter: `id=eq.${purchaseOrder.id}`
            },
            async (payload) => {
                if (payload.new.status !== purchaseOrder.status ||
                    payload.new.payment_status !== purchaseOrder.payment_status) {
                    
                    purchaseOrder.status = payload.new.status;
                    purchaseOrder.payment_status = payload.new.payment_status;
                    
                    renderStatusBar();
                    renderActionButtons();
                    showToast(`Order status updated to ${payload.new.status}`);
                }
            }
        )
        .subscribe();
}

// ============================================
// EXPORT FUNCTIONS FOR GLOBAL SCOPE
// ============================================
window.printPO = printPO;
window.downloadPO = downloadPO;
window.emailPO = emailPO;
window.showPaymentModal = showPaymentModal;
window.showConfirmModal = showConfirmModal;
window.handleConfirmAction = handleConfirmAction;
window.closeConfirmModal = closeConfirmModal;
window.closeSuccessModal = closeSuccessModal;