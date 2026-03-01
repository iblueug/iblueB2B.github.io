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
let supplierProfile = null;
let currentInquiry = null;
let currentQuote = null;
let currentTab = 'new';

// Data stores
let inquiries = {
    new: [],
    draft: [],
    sent: [],
    accepted: []
};

// ============================================
// INITIALIZATION
// ============================================
document.addEventListener('DOMContentLoaded', async () => {
    await checkAuth();
    await loadSupplierProfile();
    
    // Only proceed if supplier profile exists
    if (supplierProfile) {
        await loadAllInquiries();
        setupRealtimeSubscription();
    }
    
    setupEventListeners();
});

// ============================================
// AUTHENTICATION
// ============================================
async function checkAuth() {
    try {
        const { data: { user }, error } = await sb.auth.getUser();
        if (error) throw error;
        
        if (!user) {
            // Store current page to redirect back after login
            sessionStorage.setItem('redirectAfterLogin', window.location.pathname);
            window.location.href = 'login.html';
            return;
        }
        
        currentUser = user;
        console.log('User authenticated:', user.id);
        
    } catch (error) {
        console.error('Error checking auth:', error);
        showToast('Authentication error. Please login again.');
        setTimeout(() => {
            window.location.href = 'login.html';
        }, 2000);
    }
}

// ============================================
// SUPPLIER PROFILE LOADING (FIXED)
// ============================================
async function loadSupplierProfile() {
    try {
        console.log('Loading supplier profile for user:', currentUser?.id);
        
        // Use maybeSingle() instead of single() to avoid PGRST116 error
        const { data, error } = await sb
            .from('suppliers')
            .select('*')
            .eq('profile_id', currentUser.id)
            .maybeSingle(); // This returns null instead of throwing error when no rows
            
        if (error) {
            console.error('Database error loading supplier:', error);
            showToast('Error loading supplier profile');
            return;
        }
        
        if (!data) {
            // No supplier profile found - this is the root cause
            console.log('❌ No supplier profile found in database for user:', currentUser.id);
            
            // Check if user is a supplier in profiles table
            const { data: profile, error: profileError } = await sb
                .from('profiles')
                .select('is_supplier, onboarding_step')
                .eq('id', currentUser.id)
                .maybeSingle();
                
            if (profileError) {
                console.error('Error checking profile:', profileError);
            }
            
            console.log('Profile data:', profile);
            
            // Show onboarding message
            showOnboardingModal();
            return;
        }
        
        // Supplier profile found!
        supplierProfile = data;
        console.log('✅ Supplier profile loaded:', supplierProfile.id, supplierProfile.business_name);
        
        // Hide onboarding message if visible
        hideOnboardingModal();
        
    } catch (error) {
        console.error('Unexpected error loading supplier profile:', error);
        showToast('Failed to load supplier profile');
    }
}

// ============================================
// ONBOARDING MODAL
// ============================================
function showOnboardingModal() {
    // Check if modal already exists
    let modal = document.getElementById('onboardingModal');
    
    if (!modal) {
        // Create modal
        modal = document.createElement('div');
        modal.id = 'onboardingModal';
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content" style="max-width: 400px; text-align: center;">
                <div class="modal-icon warning" style="background: #FEF3C7; color: #D97706;">
                    <i class="fas fa-exclamation-triangle"></i>
                </div>
                <h3 style="margin-bottom: 12px;">Supplier Profile Required</h3>
                <p style="margin-bottom: 16px; color: var(--gray-600);">
                    You need to complete your supplier registration before you can access quotations.
                </p>
                <div style="background: var(--gray-100); padding: 16px; border-radius: var(--radius); margin-bottom: 20px; text-align: left;">
                    <p style="font-weight: 600; margin-bottom: 8px;">Next steps:</p>
                    <ol style="margin-left: 20px; color: var(--gray-600); font-size: 14px;">
                        <li>Register your business</li>
                        <li>Add your products</li>
                        <li>Get verified</li>
                    </ol>
                </div>
                <div class="modal-actions" style="flex-direction: column; gap: 10px;">
                    <button class="btn-primary" onclick="window.location.href='supplier-register.html'" style="width: 100%;">
                        Complete Registration
                    </button>
                    <button class="btn-secondary" onclick="window.location.href='index.html'" style="width: 100%;">
                        Back to Home
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }
    
    modal.classList.add('show');
    
    // Also update the empty state message
    const emptyState = document.getElementById('emptyState');
    if (emptyState) {
        emptyState.innerHTML = `
            <i class="fas fa-user-plus" style="font-size: 48px; color: var(--primary);"></i>
            <h3>Complete Your Supplier Profile</h3>
            <p>Register as a supplier to start receiving and managing quotations.</p>
            <button class="btn-primary" onclick="window.location.href='supplier-register.html'" style="margin-top: 16px;">
                Register Now
            </button>
        `;
        emptyState.style.display = 'block';
    }
    
    // Hide loading state
    showLoading(false);
}

function hideOnboardingModal() {
    const modal = document.getElementById('onboardingModal');
    if (modal) {
        modal.classList.remove('show');
    }
}

// ============================================
// LOAD INQUIRIES (with null checks)
// ============================================
async function loadAllInquiries() {
    if (!supplierProfile || !supplierProfile.id) {
        console.log('No supplier profile available, skipping inquiry load');
        return;
    }
    
    showLoading(true);
    
    try {
        // Use Promise.allSettled to prevent one failure from stopping others
        const results = await Promise.allSettled([
            loadNewInquiries(),
            loadDraftQuotes(),
            loadSentQuotes(),
            loadAcceptedQuotes()
        ]);
        
        // Log any failures
        results.forEach((result, index) => {
            if (result.status === 'rejected') {
                console.error(`Query ${index} failed:`, result.reason);
            }
        });
        
        updateStats();
        updateTabBadges();
        
        const currentItems = getCurrentTabInquiries();
        if (currentItems.length === 0) {
            showEmptyState(true, supplierProfile ? 'No inquiries found' : 'Complete your profile to get started');
        } else {
            showEmptyState(false);
            renderCurrentTab();
        }
        
    } catch (error) {
        console.error('Error in loadAllInquiries:', error);
        showToast('Failed to load some inquiries');
    } finally {
        showLoading(false);
    }
}

async function loadNewInquiries() {
    // Guard clause - if no supplier profile, return empty array
    if (!supplierProfile || !supplierProfile.id) {
        inquiries.new = [];
        return [];
    }
    
    try {
        // Get inquiries sent to this supplier
        const { data: matches, error: matchError } = await sb
            .from('inquiry_supplier_matches')
            .select(`
                inquiry_id,
                inquiry_requests!inner (
                    id,
                    inquiry_number,
                    title,
                    description,
                    buyer_id,
                    expected_delivery_date,
                    payment_terms,
                    delivery_terms,
                    shipping_address,
                    shipping_district,
                    status,
                    expires_at,
                    created_at,
                    profiles!inquiry_requests_buyer_id_fkey (
                        id,
                        full_name,
                        business_name,
                        avatar_url,
                        location
                    )
                )
            `)
            .eq('supplier_id', supplierProfile.id)
            .eq('has_quoted', false)
            .order('created_at', { ascending: false });
            
        if (matchError) throw matchError;
        
        if (!matches || matches.length === 0) {
            inquiries.new = [];
            return [];
        }
        
        // Get full inquiry details including items
        const inquiryPromises = matches.map(async (match) => {
            if (!match || !match.inquiry_requests) return null;
            
            const inquiry = match.inquiry_requests;
            const [items, attachments] = await Promise.all([
                loadInquiryItems(inquiry.id).catch(() => []),
                loadInquiryAttachments(inquiry.id).catch(() => [])
            ]);
            
            return {
                ...inquiry,
                items: items || [],
                attachments: attachments || []
            };
        });
        
        const results = await Promise.all(inquiryPromises);
        inquiries.new = results.filter(inq => inq !== null);
        
    } catch (error) {
        console.error('Error loading new inquiries:', error);
        inquiries.new = [];
    }
}

async function loadDraftQuotes() {
    if (!supplierProfile || !supplierProfile.id) {
        inquiries.draft = [];
        return [];
    }
    
    try {
        const { data: quotes, error } = await sb
            .from('supplier_quotes')
            .select(`
                *,
                inquiry_requests!inner (
                    id,
                    inquiry_number,
                    title,
                    buyer_id,
                    expected_delivery_date,
                    shipping_district,
                    profiles!inquiry_requests_buyer_id_fkey (
                        full_name,
                        business_name,
                        avatar_url,
                        location
                    )
                )
            `)
            .eq('supplier_id', supplierProfile.id)
            .eq('status', 'draft')
            .order('created_at', { ascending: false });
            
        if (error) throw error;
        
        if (!quotes || quotes.length === 0) {
            inquiries.draft = [];
            return [];
        }
        
        // Load quote items for each draft
        const draftPromises = quotes.map(async (quote) => {
            if (!quote || !quote.inquiry_requests) return null;
            
            const items = await loadQuoteItems(quote.id).catch(() => []);
            return {
                ...quote,
                items: items || [],
                inquiry: quote.inquiry_requests
            };
        });
        
        const results = await Promise.all(draftPromises);
        inquiries.draft = results.filter(q => q !== null);
        
    } catch (error) {
        console.error('Error loading draft quotes:', error);
        inquiries.draft = [];
    }
}

async function loadSentQuotes() {
    if (!supplierProfile || !supplierProfile.id) {
        inquiries.sent = [];
        return [];
    }
    
    try {
        const { data: quotes, error } = await sb
            .from('supplier_quotes')
            .select(`
                *,
                inquiry_requests!inner (
                    id,
                    inquiry_number,
                    title,
                    buyer_id,
                    profiles!inquiry_requests_buyer_id_fkey (
                        full_name,
                        business_name,
                        avatar_url,
                        location
                    )
                )
            `)
            .eq('supplier_id', supplierProfile.id)
            .eq('status', 'sent')
            .order('created_at', { ascending: false });
            
        if (error) throw error;
        
        if (!quotes || quotes.length === 0) {
            inquiries.sent = [];
            return [];
        }
        
        const sentPromises = quotes.map(async (quote) => {
            if (!quote || !quote.inquiry_requests) return null;
            
            const items = await loadQuoteItems(quote.id).catch(() => []);
            return {
                ...quote,
                items: items || [],
                inquiry: quote.inquiry_requests
            };
        });
        
        const results = await Promise.all(sentPromises);
        inquiries.sent = results.filter(q => q !== null);
        
    } catch (error) {
        console.error('Error loading sent quotes:', error);
        inquiries.sent = [];
    }
}

async function loadAcceptedQuotes() {
    if (!supplierProfile || !supplierProfile.id) {
        inquiries.accepted = [];
        return [];
    }
    
    try {
        const { data: quotes, error } = await sb
            .from('supplier_quotes')
            .select(`
                *,
                inquiry_requests!inner (
                    id,
                    inquiry_number,
                    title,
                    buyer_id,
                    profiles!inquiry_requests_buyer_id_fkey (
                        full_name,
                        business_name,
                        avatar_url,
                        location
                    )
                )
            `)
            .eq('supplier_id', supplierProfile.id)
            .in('status', ['accepted', 'converted'])
            .order('created_at', { ascending: false });
            
        if (error) throw error;
        
        if (!quotes || quotes.length === 0) {
            inquiries.accepted = [];
            return [];
        }
        
        const acceptedPromises = quotes.map(async (quote) => {
            if (!quote || !quote.inquiry_requests) return null;
            
            const items = await loadQuoteItems(quote.id).catch(() => []);
            return {
                ...quote,
                items: items || [],
                inquiry: quote.inquiry_requests
            };
        });
        
        const results = await Promise.all(acceptedPromises);
        inquiries.accepted = results.filter(q => q !== null);
        
    } catch (error) {
        console.error('Error loading accepted quotes:', error);
        inquiries.accepted = [];
    }
}

async function loadInquiryItems(inquiryId) {
    if (!inquiryId) return [];
    
    try {
        const { data, error } = await sb
            .from('inquiry_items')
            .select('*')
            .eq('inquiry_id', inquiryId);
            
        if (error) throw error;
        return data || [];
    } catch (error) {
        console.error('Error loading inquiry items:', error);
        return [];
    }
}

async function loadInquiryAttachments(inquiryId) {
    if (!inquiryId) return [];
    
    try {
        const { data, error } = await sb
            .from('rfq_attachments')
            .select('*')
            .eq('negotiation_id', inquiryId);
            
        if (error) throw error;
        return data || [];
    } catch (error) {
        console.error('Error loading attachments:', error);
        return [];
    }
}

async function loadQuoteItems(quoteId) {
    if (!quoteId) return [];
    
    try {
        const { data, error } = await sb
            .from('supplier_quote_items')
            .select('*')
            .eq('supplier_quote_id', quoteId);
            
        if (error) throw error;
        return data || [];
    } catch (error) {
        console.error('Error loading quote items:', error);
        return [];
    }
}

// ============================================
// RENDERING FUNCTIONS
// ============================================
function renderCurrentTab() {
    if (!supplierProfile) {
        showEmptyState(true, 'Complete your supplier registration to view inquiries');
        return;
    }
    
    const listId = getCurrentTabListId();
    const container = document.getElementById(listId);
    if (!container) return;
    
    const items = getCurrentTabInquiries();
    
    if (items.length === 0) {
        container.innerHTML = '';
        showEmptyState(true, getEmptyStateMessage());
        return;
    }
    
    container.innerHTML = items.map(item => {
        if (!item) return '';
        
        if (currentTab === 'new') {
            return renderNewInquiryCard(item);
        } else if (currentTab === 'draft') {
            return renderDraftQuoteCard(item);
        } else {
            return renderQuoteCard(item);
        }
    }).join('');
    
    showEmptyState(false);
}

function getEmptyStateMessage() {
    switch(currentTab) {
        case 'new': return 'No new inquiries at the moment';
        case 'draft': return 'No draft quotes';
        case 'sent': return 'No sent quotes yet';
        case 'accepted': return 'No accepted quotes yet';
        default: return 'No items found';
    }
}

// ... (rest of the rendering functions remain the same as previous version)

// ============================================
// QUOTE CREATION (with null checks)
// ============================================
async function createQuote(inquiryId) {
    if (!supplierProfile) {
        showToast('Please complete your supplier registration first');
        window.location.href = 'supplier-register.html';
        return;
    }
    
    showLoading(true);
    
    try {
        // Load full inquiry details
        const { data: inquiry, error: inquiryError } = await sb
            .from('inquiry_requests')
            .select(`
                *,
                profiles!inquiry_requests_buyer_id_fkey (
                    full_name,
                    business_name,
                    avatar_url,
                    location,
                    phone,
                    email
                ),
                inquiry_items (*)
            `)
            .eq('id', inquiryId)
            .maybeSingle(); // Use maybeSingle here too
            
        if (inquiryError) throw inquiryError;
        
        if (!inquiry) {
            throw new Error('Inquiry not found');
        }
        
        // Check for existing draft
        const { data: existingDraft } = await sb
            .from('supplier_quotes')
            .select('*')
            .eq('inquiry_id', inquiryId)
            .eq('supplier_id', supplierProfile.id)
            .eq('status', 'draft')
            .maybeSingle();
            
        if (existingDraft) {
            // Continue with existing draft
            await continueDraft(existingDraft.id);
            return;
        }
        
        currentInquiry = inquiry;
        
        // Create new quote in modal
        renderQuoteCreationModal(inquiry);
        document.getElementById('quoteModal').classList.add('show');
        
    } catch (error) {
        console.error('Error creating quote:', error);
        showToast('Failed to load inquiry details');
    } finally {
        showLoading(false);
    }
}

// ============================================
// UTILITY FUNCTIONS
// ============================================
function showLoading(show) {
    const loadingEl = document.getElementById('loadingState');
    const mainContent = document.getElementById('mainContent');
    
    if (!loadingEl || !mainContent) return;
    
    if (show) {
        loadingEl.style.display = 'block';
        mainContent.style.display = 'none';
    } else {
        loadingEl.style.display = 'none';
        mainContent.style.display = 'block';
    }
}

function showEmptyState(show, message) {
    const emptyEl = document.getElementById('emptyState');
    if (!emptyEl) return;
    
    if (show) {
        emptyEl.style.display = 'block';
        const messageEl = emptyEl.querySelector('p');
        if (messageEl && message) {
            messageEl.textContent = message;
        }
        
        // If no supplier profile, show registration button
        if (!supplierProfile) {
            const registerBtn = emptyEl.querySelector('.register-btn');
            if (!registerBtn) {
                const btn = document.createElement('button');
                btn.className = 'btn-primary register-btn';
                btn.innerHTML = 'Register as Supplier';
                btn.onclick = () => window.location.href = 'supplier-register.html';
                emptyEl.appendChild(btn);
            }
        }
    } else {
        emptyEl.style.display = 'none';
    }
}

// ============================================
// DEBUG FUNCTION - Add this to check database state
// ============================================
async function debugDatabaseState() {
    console.log('=== DATABASE DEBUG ===');
    console.log('Current user:', currentUser?.id);
    
    // Check suppliers table
    const { data: suppliers, error: supError } = await sb
        .from('suppliers')
        .select('*')
        .eq('profile_id', currentUser?.id);
        
    console.log('Suppliers found:', suppliers?.length || 0);
    if (supError) console.error('Suppliers error:', supError);
    
    // Check profiles table
    const { data: profile, error: profError } = await sb
        .from('profiles')
        .select('*')
        .eq('id', currentUser?.id)
        .maybeSingle();
        
    console.log('Profile:', profile);
    if (profError) console.error('Profile error:', profError);
    
    // Check inquiry matches
    if (supplierProfile?.id) {
        const { data: matches, error: matchError } = await sb
            .from('inquiry_supplier_matches')
            .select('count')
            .eq('supplier_id', supplierProfile.id);
            
        console.log('Inquiry matches:', matches);
    }
}

// Call debug function in console if needed
window.debugDB = debugDatabaseState;

// ============================================
// EXPORT FUNCTIONS
// ============================================
window.createQuote = createQuote;
window.debugDB = debugDatabaseState;
// ... export other functions as before