// ============================================
// SUPABASE CONFIGURATION
// ============================================
const SUPABASE_URL = 'https://uufhvmmgwzkxvvdbqemz.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV1Zmh2bW1nd3preHZ2ZGJxZW16Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAzMDIzNTYsImV4cCI6MjA4NTg3ODM1Nn0.WABHx4ilFRkhPHP-y4ZC4E8Kb7PRqY-cyxI8cVS8Tyc';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ============================================
// STATE MANAGEMENT
// ============================================
let currentStep = 1;
let currentUser = null;
let supplierProfile = null;
let uploadedFiles = {
    certificate: null,
    tin: null,
    logo: null,
    additional: []
};

// Compression profiles for different document types
const compressionProfiles = {
    certificate: {
        maxSizeMB: 1,           // 1MB for certificates
        maxWidthOrHeight: 1200,  // Max dimension
        useWebWorker: true,
        fileType: 'image/jpeg',  // Convert to JPEG for documents
        initialQuality: 0.85,    // Initial quality (0-1)
        alwaysKeepResolution: false,
        maxIteration: 10
    },
    logo: {
        maxSizeMB: 0.5,         // 500KB for logos
        maxWidthOrHeight: 800,   // Max dimension for logos
        useWebWorker: true,
        fileType: 'image/webp',  // WebP for better compression
        initialQuality: 0.9,
        alwaysKeepResolution: false,
        maxIteration: 10
    },
    tin: {
        maxSizeMB: 1,
        maxWidthOrHeight: 1200,
        useWebWorker: true,
        fileType: 'image/jpeg',
        initialQuality: 0.85,
        alwaysKeepResolution: false,
        maxIteration: 10
    },
    additional: {
        maxSizeMB: 1,
        maxWidthOrHeight: 1200,
        useWebWorker: true,
        fileType: 'image/jpeg',
        initialQuality: 0.85,
        alwaysKeepResolution: false,
        maxIteration: 10
    }
};

// ============================================
// INITIALIZATION
// ============================================
document.addEventListener('DOMContentLoaded', async () => {
    await checkAuth();
    setupEventListeners();
    setupFileUploads();
    loadDistricts();
});

// ============================================
// CHECK AUTH
// ============================================
async function checkAuth() {
    try {
        showLoading(true, 'Checking authentication...');
        
        const { data: { user }, error } = await sb.auth.getUser();
        
        if (error) throw error;
        
        if (!user) {
            showToast('Please login to register as a supplier', 'error');
            setTimeout(() => {
                window.location.href = 'login.html?redirect=supplier-register.html';
            }, 2000);
            return;
        }
        
        currentUser = user;
        console.log('User authenticated:', user.id);
        
        // Check if already a supplier
        const { data: existingSupplier, error: supplierError } = await sb
            .from('suppliers')
            .select('id, verification_status')
            .eq('profile_id', user.id)
            .maybeSingle();
        
        if (supplierError) throw supplierError;
        
        if (existingSupplier) {
            showToast('You are already registered as a supplier', 'success');
            setTimeout(() => {
                window.location.href = 'supplier-dashboard.html';
            }, 1500);
            return;
        }
        
        // Pre-fill email from auth
        document.getElementById('businessEmail').value = user.email || '';
        
    } catch (error) {
        console.error('Auth check error:', error);
        showToast('Authentication error. Please login again.', 'error');
        setTimeout(() => {
            window.location.href = 'login.html';
        }, 2000);
    } finally {
        showLoading(false);
    }
}

// ============================================
// LOAD DISTRICTS
// ============================================
function loadDistricts() {
    const districts = [
        'Kampala', 'Wakiso', 'Mukono', 'Jinja', 'Mbarara', 'Gulu', 'Lira',
        'Masaka', 'Mbale', 'Arua', 'Fort Portal', 'Kabale', 'Bushenyi',
        'Tororo', 'Entebbe', 'Kasese', 'Soroti', 'Moroto', 'Kitgum', 'Nebbi'
    ];
    
    const select = document.getElementById('district');
    if (select) {
        select.innerHTML = '<option value="">Select district</option>' +
            districts.map(d => `<option value="${d}">${d}</option>`).join('');
    }
}

// ============================================
// SETUP EVENT LISTENERS
// ============================================
function setupEventListeners() {
    // Step navigation
    document.getElementById('nextToStep2')?.addEventListener('click', validateStep1);
    document.getElementById('backToStep1')?.addEventListener('click', () => goToStep(1));
    document.getElementById('submitVerification')?.addEventListener('click', submitVerification);
    
    // Phone validation
    document.getElementById('phone')?.addEventListener('input', validatePhone);
    document.getElementById('altPhone')?.addEventListener('input', validateAltPhone);
    
    // Auto-format phone numbers
    document.getElementById('phone')?.addEventListener('blur', formatPhoneNumber);
    document.getElementById('altPhone')?.addEventListener('blur', formatPhoneNumber);
    
    // Slug generation
    document.getElementById('businessName')?.addEventListener('input', generateSlug);
}

// ============================================
// STEP NAVIGATION
// ============================================
function goToStep(step) {
    // Hide all steps
    document.querySelectorAll('.step').forEach(s => s.classList.remove('active'));
    document.getElementById(`step${step}`).classList.add('active');
    
    // Update progress bar
    document.querySelectorAll('.progress-step').forEach((s, i) => {
        const stepNum = i + 1;
        s.classList.remove('active', 'completed');
        
        if (stepNum < step) {
            s.classList.add('completed');
        } else if (stepNum === step) {
            s.classList.add('active');
        }
    });
    
    // Update progress fill
    const fill = document.getElementById('progressFill');
    const percentage = ((step - 1) / 2) * 100;
    fill.style.width = `${percentage}%`;
    
    currentStep = step;
    
    // Scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ============================================
// VALIDATE STEP 1
// ============================================
async function validateStep1() {
    // Clear previous errors
    document.querySelectorAll('.error-message').forEach(e => e.classList.remove('show'));
    document.querySelectorAll('.form-input, .form-select').forEach(e => e.classList.remove('error'));
    
    let isValid = true;
    
    // Get values
    const email = document.getElementById('businessEmail').value.trim();
    const businessName = document.getElementById('businessName').value.trim();
    const phone = document.getElementById('phone').value.trim();
    const altPhone = document.getElementById('altPhone').value.trim();
    const businessType = document.getElementById('businessType').value;
    const warehouseLocation = document.getElementById('warehouseLocation').value.trim();
    const district = document.getElementById('district').value;
    const serviceAreas = document.getElementById('serviceAreas').selectedOptions.length;
    const terms = document.getElementById('acceptTerms').checked;
    
    // Validate email
    if (!email) {
        showFieldError('businessEmail', 'Email is required');
        isValid = false;
    } else if (!isValidEmail(email)) {
        showFieldError('businessEmail', 'Enter a valid email address');
        isValid = false;
    }
    
    // Validate business name
    if (!businessName) {
        showFieldError('businessName', 'Business name is required');
        isValid = false;
    } else if (businessName.length < 2) {
        showFieldError('businessName', 'Business name is too short');
        isValid = false;
    }
    
    // Validate phone
    if (!phone) {
        showFieldError('phone', 'Phone number is required');
        isValid = false;
    } else if (!isValidUgPhone(phone)) {
        showFieldError('phone', 'Enter a valid Ugandan phone number (e.g., 0772 123456)');
        isValid = false;
    }
    
    // Validate alternative phone if provided
    if (altPhone && !isValidUgPhone(altPhone)) {
        showFieldError('altPhone', 'Enter a valid Ugandan phone number');
        isValid = false;
    }
    
    // Validate business type
    if (!businessType) {
        showFieldError('businessType', 'Select your business type');
        isValid = false;
    }
    
    // Validate year established if provided
    const yearEst = document.getElementById('yearEstablished').value;
    if (yearEst) {
        const year = parseInt(yearEst);
        const currentYear = new Date().getFullYear();
        if (year < 1900 || year > currentYear) {
            showFieldError('yearEstablished', `Year must be between 1900 and ${currentYear}`);
            isValid = false;
        }
    }
    
    // Validate warehouse location
    if (!warehouseLocation) {
        showFieldError('warehouseLocation', 'Location is required');
        isValid = false;
    } else if (warehouseLocation.length < 5) {
        showFieldError('warehouseLocation', 'Please enter a complete address');
        isValid = false;
    }
    
    // Validate district
    if (!district) {
        showFieldError('district', 'Select your district');
        isValid = false;
    }
    
    // Validate service areas
    if (serviceAreas === 0) {
        showFieldError('serviceAreas', 'Select at least one service area');
        isValid = false;
    }
    
    // Validate terms
    if (!terms) {
        showToast('Please accept the terms and conditions to continue', 'error');
        isValid = false;
    }
    
    if (isValid) {
        // Store data in session for next step
        const businessInfo = {
            email,
            businessName,
            phone,
            altPhone: altPhone || null,
            businessType,
            yearEstablished: yearEst || null,
            businessReg: document.getElementById('businessReg').value.trim() || null,
            tinNumber: document.getElementById('tinNumber').value.trim() || null,
            warehouseLocation,
            district,
            serviceAreas: Array.from(document.getElementById('serviceAreas').selectedOptions).map(o => o.value),
            minOrderValue: document.getElementById('minOrderValue').value || null,
            deliveryOptions: Array.from(document.getElementById('deliveryOptions').selectedOptions).map(o => o.value)
        };
        
        sessionStorage.setItem('supplierBusinessInfo', JSON.stringify(businessInfo));
        
        // Animate to next step
        goToStep(2);
        showToast('Business information saved! Now upload your documents.', 'success');
    }
}

function showFieldError(fieldId, message) {
    const field = document.getElementById(fieldId);
    field.classList.add('error');
    
    // Try to find error message element
    let errorEl = document.getElementById(fieldId + 'Error');
    
    // If not found, create one
    if (!errorEl) {
        errorEl = document.createElement('div');
        errorEl.className = 'error-message';
        errorEl.id = fieldId + 'Error';
        field.parentNode.appendChild(errorEl);
    }
    
    errorEl.textContent = message;
    errorEl.classList.add('show');
    
    // Shake the field
    field.style.animation = 'shake 0.3s ease';
    setTimeout(() => {
        field.style.animation = '';
    }, 300);
}

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidUgPhone(phone) {
    const cleaned = phone.replace(/\D/g, '');
    // Ugandan phone: 07XXXXXXXX or 256XXXXXXXXX
    return /^(0|256)?[0-9]{9}$/.test(cleaned) && cleaned.length >= 9;
}

function formatPhoneNumber(e) {
    const input = e.target;
    let value = input.value.replace(/\D/g, '');
    
    if (value.length > 0) {
        // Format as 0XXX XXX XXX
        if (value.length >= 10) {
            value = value.substring(0, 10);
            input.value = value.replace(/(\d{4})(\d{3})(\d{3})/, '$1 $2 $3');
        } else if (value.length >= 7) {
            input.value = value.replace(/(\d{4})(\d{3})/, '$1 $2');
        } else if (value.length >= 4) {
            input.value = value.replace(/(\d{4})/, '$1');
        }
    }
}

function validatePhone(e) {
    const phone = e.target.value;
    if (phone && !isValidUgPhone(phone)) {
        e.target.classList.add('error');
    } else {
        e.target.classList.remove('error');
    }
}

function validateAltPhone(e) {
    const phone = e.target.value;
    if (phone && !isValidUgPhone(phone)) {
        e.target.classList.add('error');
    } else {
        e.target.classList.remove('error');
    }
}

function generateSlug() {
    const name = document.getElementById('businessName').value;
    const slug = name.toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
    // Store slug in hidden field or use for URL
    console.log('Business slug:', slug);
}

// ============================================
// FILE UPLOAD SYSTEM (Based on working example)
// ============================================
function setupFileUploads() {
    // Certificate upload
    setupUploadArea('uploadCert', 'certFile', 'certFileList', 'certificate', true);
    
    // TIN upload
    setupUploadArea('uploadTIN', 'tinFile', 'tinFileList', 'tin', true);
    
    // Logo upload
    setupUploadArea('uploadLogo', 'logoFile', 'logoFileList', 'logo', true, true);
    
    // Additional files
    setupUploadArea('uploadAdditional', 'additionalFiles', 'additionalFileList', 'additional', false);
}

function setupUploadArea(areaId, inputId, listId, fileType, singleFile = true, isLogo = false) {
    const area = document.getElementById(areaId);
    const input = document.getElementById(inputId);
    
    if (!area || !input) return;
    
    // Click to upload
    area.addEventListener('click', () => input.click());
    
    // Drag and drop
    area.addEventListener('dragover', (e) => {
        e.preventDefault();
        area.classList.add('dragover');
    });
    
    area.addEventListener('dragleave', () => {
        area.classList.remove('dragover');
    });
    
    area.addEventListener('drop', (e) => {
        e.preventDefault();
        area.classList.remove('dragover');
        
        const files = Array.from(e.dataTransfer.files);
        handleFiles(files, fileType, singleFile, isLogo);
    });
    
    // File input change
    input.addEventListener('change', () => {
        const files = Array.from(input.files);
        handleFiles(files, fileType, singleFile, isLogo);
        input.value = ''; // Reset so same file can be uploaded again
    });
}

function handleFiles(files, fileType, singleFile, isLogo) {
    if (singleFile) {
        const file = files[0];
        if (file) {
            // Validate file type
            const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/pdf'];
            if (!allowedTypes.includes(file.type) && !file.name.match(/\.(jpg|jpeg|png|webp|pdf)$/i)) {
                showToast('Please upload an image (JPG, PNG) or PDF file', 'error');
                return;
            }
            
            // Validate file size (max 10MB before compression)
            if (file.size > 10 * 1024 * 1024) {
                showToast('File size should be less than 10MB', 'error');
                return;
            }
            
            // Process file
            processFile(file, fileType, isLogo);
        }
    } else {
        // Multiple files
        Array.from(files).forEach(file => {
            // Validate each file
            const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/pdf'];
            if (!allowedTypes.includes(file.type) && !file.name.match(/\.(jpg|jpeg|png|webp|pdf)$/i)) {
                showToast(`File ${file.name} is not a supported format`, 'error');
                return;
            }
            
            if (file.size > 10 * 1024 * 1024) {
                showToast(`File ${file.name} exceeds 10MB`, 'error');
                return;
            }
            
            processFile(file, fileType, false, true);
        });
    }
}

async function processFile(file, fileType, isLogo, isAdditional = false) {
    try {
        showLoading(true, `Processing ${file.name}...`);
        
        // Select compression profile
        let profile;
        if (isLogo) {
            profile = compressionProfiles.logo;
        } else if (fileType === 'certificate') {
            profile = compressionProfiles.certificate;
        } else if (fileType === 'tin') {
            profile = compressionProfiles.tin;
        } else {
            profile = compressionProfiles.additional;
        }
        
        // Create preview while processing
        let processedFile = file;
        
        // Compress if it's an image
        if (file.type.startsWith('image/')) {
            showToast(`Compressing ${file.name}...`, 'info');
            
            try {
                processedFile = await imageCompression(file, profile);
                
                // Calculate compression stats
                const originalSizeKB = (file.size / 1024).toFixed(0);
                const compressedSizeKB = (processedFile.size / 1024).toFixed(0);
                const compressionRatio = ((1 - processedFile.size / file.size) * 100).toFixed(0);
                
                console.log(`📸 Compression stats for ${fileType}:`, {
                    original: `${originalSizeKB}KB`,
                    compressed: `${compressedSizeKB}KB`,
                    saved: `${compressionRatio}%`,
                    format: processedFile.type
                });
                
                showToast(`Compressed: ${originalSizeKB}KB → ${compressedSizeKB}KB (${compressionRatio}% smaller)`, 'success');
            } catch (compError) {
                console.error('Compression error:', compError);
                // Continue with original file if compression fails
                showToast('Using original file (compression failed)', 'warning');
            }
        }
        
        // Generate filename
        const timestamp = Date.now();
        const safeFileName = file.name.replace(/[^a-zA-Z0-9.]/g, '_');
        const fileName = `${timestamp}_${fileType}_${safeFileName}`;
        
        // Update state
        if (isAdditional) {
            if (!uploadedFiles.additional) uploadedFiles.additional = [];
            uploadedFiles.additional.push(processedFile);
        } else {
            uploadedFiles[fileType] = processedFile;
        }
        
        // Display file in UI
        displayFile(processedFile, fileType + 'FileList', fileType, isAdditional);
        
        // Show original vs compressed size
        if (file.size !== processedFile.size) {
            const originalKB = (file.size / 1024).toFixed(0);
            const compressedKB = (processedFile.size / 1024).toFixed(0);
            const saved = ((1 - processedFile.size / file.size) * 100).toFixed(0);
            
            const fileItem = document.querySelector(`#${fileType}FileList .file-item:last-child`);
            if (fileItem) {
                const sizeSpan = fileItem.querySelector('.file-size');
                if (sizeSpan) {
                    sizeSpan.innerHTML = `(${originalKB}KB → ${compressedKB}KB, -${saved}%)`;
                }
            }
        }
        
    } catch (error) {
        console.error('Error processing file:', error);
        showToast(`Error processing ${file.name}`, 'error');
    } finally {
        showLoading(false);
    }
}

function displayFile(file, listId, fileType, isAdditional = false) {
    const list = document.getElementById(listId);
    if (!list) return;
    
    // Check if file already exists
    const existingItems = list.querySelectorAll('.file-item');
    for (let item of existingItems) {
        const nameSpan = item.querySelector('.file-name span');
        if (nameSpan && nameSpan.textContent === file.name) {
            showToast('File already added', 'warning');
            return;
        }
    }
    
    // Get file icon based on type
    let icon = 'fa-file';
    if (file.type.includes('pdf')) icon = 'fa-file-pdf';
    else if (file.type.includes('image')) icon = 'fa-file-image';
    else if (file.type.includes('word')) icon = 'fa-file-word';
    else if (file.type.includes('excel')) icon = 'fa-file-excel';
    
    const fileItem = document.createElement('div');
    fileItem.className = 'file-item';
    fileItem.innerHTML = `
        <div class="file-name">
            <i class="fas ${icon}" style="color: var(--primary);"></i>
            <span>${file.name}</span>
            <span class="file-size">(${(file.size / 1024).toFixed(0)} KB)</span>
        </div>
        <div class="file-remove" onclick="removeFile('${fileType}', '${file.name}', this, ${isAdditional})">
            <i class="fas fa-times"></i>
        </div>
    `;
    
    // Add with animation
    fileItem.style.opacity = '0';
    fileItem.style.transform = 'translateY(-10px)';
    list.appendChild(fileItem);
    
    setTimeout(() => {
        fileItem.style.transition = 'all 0.3s';
        fileItem.style.opacity = '1';
        fileItem.style.transform = 'translateY(0)';
    }, 10);
}

// Global remove function
window.removeFile = function(type, fileName, element, isAdditional = false) {
    if (isAdditional) {
        uploadedFiles.additional = uploadedFiles.additional.filter(f => f.name !== fileName);
    } else {
        uploadedFiles[type] = null;
    }
    
    // Animate removal
    const fileItem = element.closest('.file-item');
    fileItem.style.transition = 'all 0.3s';
    fileItem.style.opacity = '0';
    fileItem.style.transform = 'translateX(20px)';
    
    setTimeout(() => {
        fileItem.remove();
    }, 300);
    
    showToast('File removed', 'info');
};

// ============================================
// SUBMIT VERIFICATION
// ============================================
async function submitVerification() {
    // Validate terms
    if (!document.getElementById('verifyAccuracy').checked) {
        showToast('Please confirm that all documents are authentic', 'error');
        return;
    }
    
    // Validate certificate upload
    if (!uploadedFiles.certificate) {
        showToast('Please upload your business registration certificate', 'error');
        // Highlight the upload area
        document.getElementById('uploadCert').style.animation = 'shake 0.3s ease';
        setTimeout(() => {
            document.getElementById('uploadCert').style.animation = '';
        }, 300);
        return;
    }
    
    // Show loading
    showLoading(true, 'Submitting your application...');
    
    try {
        // Get business info from session
        const businessInfo = JSON.parse(sessionStorage.getItem('supplierBusinessInfo'));
        
        if (!businessInfo) {
            throw new Error('Business information not found. Please restart registration.');
        }
        
        // Upload files to storage first
        showToast('Uploading documents...', 'info');
        const fileUrls = await uploadFilesToStorage();
        
        // 1. Update profile
        const { error: profileError } = await sb
            .from('profiles')
            .update({
                business_name: businessInfo.businessName,
                business_type: businessInfo.businessType,
                phone: businessInfo.phone,
                district: businessInfo.district,
                is_supplier: true,
                onboarding_step: 'verification_pending',
                updated_at: new Date().toISOString()
            })
            .eq('id', currentUser.id);
            
        if (profileError) throw profileError;

        // 2. Create supplier record
        const { data: supplier, error: supplierError } = await sb
            .from('suppliers')
            .insert({
                profile_id: currentUser.id,
                business_name: businessInfo.businessName,
                business_registration: businessInfo.businessReg,
                tax_id: businessInfo.tinNumber,
                business_type: businessInfo.businessType,
                year_established: businessInfo.yearEstablished ? parseInt(businessInfo.yearEstablished) : null,
                business_phone: businessInfo.phone,
                business_email: businessInfo.email,
                warehouse_location: businessInfo.warehouseLocation,
                warehouse_district: businessInfo.district,
                service_area: businessInfo.serviceAreas,
                min_order_value: businessInfo.minOrderValue ? parseFloat(businessInfo.minOrderValue) : 0,
                delivery_options: businessInfo.deliveryOptions,
                verification_status: 'pending',
                verification_docs: fileUrls,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            })
            .select()
            .single();

        if (supplierError) throw supplierError;

        // 3. Create notification for admin
        await sb
            .from('notifications')
            .insert({
                user_id: currentUser.id,
                type: 'admin_alert',
                title: 'New Supplier Registration',
                message: `${businessInfo.businessName} has registered as a supplier and awaits verification`,
                link: '/admin/supplier-approvals.html'
            });

        // 4. Send welcome notification to supplier
        await sb
            .from('notifications')
            .insert({
                user_id: currentUser.id,
                type: 'welcome',
                title: 'Application Received',
                message: 'Your supplier application has been submitted. We\'ll review it within 24-48 hours.',
                link: '/supplier/status.html'
            });

        // Clear session storage
        sessionStorage.removeItem('supplierBusinessInfo');
        
        // Show success
        showLoading(false);
        goToStep(3);
        
    } catch (error) {
        console.error('Error submitting supplier application:', error);
        showLoading(false);
        showToast(error.message || 'Error submitting application. Please try again.', 'error');
    }
}

async function uploadFilesToStorage() {
    const fileUrls = {
        certificate: null,
        tin: null,
        logo: null,
        additional: []
    };
    
    const timestamp = Date.now();
    const userId = currentUser.id;
    
    try {
        // Upload certificate
        if (uploadedFiles.certificate) {
            const file = uploadedFiles.certificate;
            const ext = file.name.split('.').pop().toLowerCase();
            const path = `suppliers/${userId}/certificates/${timestamp}_certificate.${ext}`;
            
            const { data, error } = await sb.storage
                .from('supplier-documents')
                .upload(path, file, {
                    cacheControl: '3600',
                    upsert: false,
                    contentType: file.type
                });
                
            if (error) throw error;
            
            const { data: { publicUrl } } = sb.storage
                .from('supplier-documents')
                .getPublicUrl(path);
                
            fileUrls.certificate = publicUrl;
        }
        
        // Upload TIN
        if (uploadedFiles.tin) {
            const file = uploadedFiles.tin;
            const ext = file.name.split('.').pop().toLowerCase();
            const path = `suppliers/${userId}/tin/${timestamp}_tin.${ext}`;
            
            const { data, error } = await sb.storage
                .from('supplier-documents')
                .upload(path, file, {
                    cacheControl: '3600',
                    upsert: false,
                    contentType: file.type
                });
                
            if (error) throw error;
            
            const { data: { publicUrl } } = sb.storage
                .from('supplier-documents')
                .getPublicUrl(path);
                
            fileUrls.tin = publicUrl;
        }
        
        // Upload logo
        if (uploadedFiles.logo) {
            const file = uploadedFiles.logo;
            const ext = file.name.split('.').pop().toLowerCase();
            const path = `suppliers/${userId}/logo/${timestamp}_logo.${ext}`;
            
            const { data, error } = await sb.storage
                .from('supplier-documents')
                .upload(path, file, {
                    cacheControl: '3600',
                    upsert: false,
                    contentType: file.type
                });
                
            if (error) throw error;
            
            const { data: { publicUrl } } = sb.storage
                .from('supplier-documents')
                .getPublicUrl(path);
                
            fileUrls.logo = publicUrl;
        }
        
        // Upload additional files
        if (uploadedFiles.additional && uploadedFiles.additional.length > 0) {
            for (let i = 0; i < uploadedFiles.additional.length; i++) {
                const file = uploadedFiles.additional[i];
                const ext = file.name.split('.').pop().toLowerCase();
                const path = `suppliers/${userId}/additional/${timestamp}_${i}_${file.name}`;
                
                const { data, error } = await sb.storage
                    .from('supplier-documents')
                    .upload(path, file, {
                        cacheControl: '3600',
                        upsert: false,
                        contentType: file.type
                    });
                    
                if (error) throw error;
                
                const { data: { publicUrl } } = sb.storage
                    .from('supplier-documents')
                    .getPublicUrl(path);
                    
                fileUrls.additional.push(publicUrl);
            }
        }
        
        return fileUrls;
        
    } catch (error) {
        console.error('Error uploading files:', error);
        throw new Error('Failed to upload documents. Please try again.');
    }
}

// ============================================
// UTILITIES
// ============================================
function showLoading(show, message = 'Loading...') {
    const overlay = document.getElementById('loadingOverlay');
    const messageEl = document.getElementById('loadingMessage');
    
    if (show) {
        messageEl.textContent = message;
        overlay.classList.add('show');
    } else {
        overlay.classList.remove('show');
    }
}

function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    if (!toast) return;
    
    // Set color based on type
    const colors = {
        success: 'var(--secondary)',
        error: 'var(--danger)',
        info: 'var(--primary)',
        warning: 'var(--warning)'
    };
    
    toast.style.backgroundColor = colors[type] || colors.info;
    toast.textContent = message;
    toast.classList.add('show');
    
    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

// ============================================
// EXPORT FUNCTIONS FOR GLOBAL SCOPE
// ============================================
window.removeFile = removeFile;
window.goToStep = goToStep;