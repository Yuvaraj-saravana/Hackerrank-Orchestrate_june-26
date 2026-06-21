// App State
let activeDataset = 'test'; // 'test' or 'sample'
let claims = [];
let selectedIndex = -1;

// Document Ready
document.addEventListener('DOMContentLoaded', () => {
    loadClaims();
    loadMetrics();
});

// Tab Switcher
function switchTab(tabName) {
    document.querySelectorAll('.tab-link').forEach(btn => {
        btn.classList.remove('active');
    });
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });

    if (tabName === 'workspace') {
        document.querySelector('.header-tabs button:nth-child(1)').classList.add('active');
        document.getElementById('tab-workspace').classList.add('active');
    } else {
        document.querySelector('.header-tabs button:nth-child(2)').classList.add('active');
        document.getElementById('tab-analytics').classList.add('active');
        loadMetrics(); // refresh metrics
    }
}

// Dataset Switcher
function switchDataset(datasetType) {
    if (activeDataset === datasetType) return;
    
    activeDataset = datasetType;
    document.getElementById('btn-dataset-test').classList.toggle('active', datasetType === 'test');
    document.getElementById('btn-dataset-sample').classList.toggle('active', datasetType === 'sample');
    
    // Clear selection
    selectedIndex = -1;
    resetWorkspace();
    loadClaims();
}

// Reset Workspace UI
function resetWorkspace() {
    document.getElementById('claim-id-display').innerText = "Select a Claim";
    document.getElementById('claim-subtitle').innerText = "Choose a claim from the sidebar to inspect visual evidence and verify claims.";
    document.getElementById('claim-object-badge').innerText = "None";
    document.getElementById('claim-object-badge').className = "badge";
    
    document.getElementById('chat-box').innerHTML = '<div class="chat-placeholder">Select a claim to display transcript.</div>';
    
    document.getElementById('hist-past-claims').innerText = '-';
    document.getElementById('hist-accepted').innerText = '-';
    document.getElementById('hist-rejected').innerText = '-';
    document.getElementById('hist-90_days').innerText = '-';
    document.getElementById('hist-summary-text').innerText = 'Select a claim...';
    document.getElementById('history-flags-wrapper').innerHTML = '';
    
    document.getElementById('reqs-list').innerHTML = '<li>Select a claim to load checklist.</li>';
    document.getElementById('image-gallery').innerHTML = `
        <div class="gallery-placeholder">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                <circle cx="8.5" cy="8.5" r="1.5"/>
                <polyline points="21 15 16 10 5 21"/>
            </svg>
            <p>Select a claim to load images.</p>
        </div>`;
    document.getElementById('image-count-badge').innerText = "0 Images";
    
    hideVerdict();
}

// Load Claims list from API
async function loadClaims() {
    const claimsUl = document.getElementById('claims-ul');
    claimsUl.innerHTML = '<li class="chat-placeholder">Loading claims...</li>';
    
    try {
        const response = await fetch(`/api/claims?dataset=${activeDataset}`);
        claims = await response.json();
        
        document.getElementById('claims-count').innerText = claims.length;
        renderClaimsList(claims);
    } catch (err) {
        claimsUl.innerHTML = `<li class="chat-placeholder danger">Error loading claims: ${err.message}</li>`;
    }
}

// Render Claims List in Sidebar
function renderClaimsList(claimsToRender) {
    const claimsUl = document.getElementById('claims-ul');
    claimsUl.innerHTML = '';
    
    if (claimsToRender.length === 0) {
        claimsUl.innerHTML = '<li class="chat-placeholder">No claims found.</li>';
        return;
    }
    
    claimsToRender.forEach((claim, idx) => {
        const originalIndex = claims.indexOf(claim);
        const li = document.createElement('li');
        li.className = `claim-item ${originalIndex === selectedIndex ? 'active' : ''}`;
        li.onclick = () => selectClaim(originalIndex);
        
        // Extract a snippet of user claim chat
        const snippet = claim.user_claim.split('|')[0] || claim.user_claim;
        
        li.innerHTML = `
            <div class="claim-item-header">
                <span class="claim-id">Claim #${originalIndex + 1}</span>
                <span class="claim-object-type">${claim.claim_object}</span>
            </div>
            <div class="claim-item-claim">${snippet.replace('Customer:', '').replace('Agent:', '').replace('Support:', '').trim()}</div>
        `;
        claimsUl.appendChild(li);
    });
}

// Filter claims in sidebar search
function filterClaimsList() {
    const query = document.getElementById('search-input').value.toLowerCase().strip();
    if (!query) {
        renderClaimsList(claims);
        return;
    }
    
    const filtered = claims.filter((claim, idx) => {
        const indexStr = `claim #${idx + 1}`.toLowerCase();
        const user_id = String(claim.user_id).toLowerCase();
        const user_claim = claim.user_claim.toLowerCase();
        const claim_object = claim.claim_object.toLowerCase();
        return indexStr.includes(query) || user_id.includes(query) || user_claim.includes(query) || claim_object.includes(query);
    });
    
    renderClaimsList(filtered);
}

// Select a claim and populate workspace
async function selectClaim(index) {
    selectedIndex = index;
    
    // Highlight active list item
    document.querySelectorAll('.claim-item').forEach((li, idx) => {
        li.classList.toggle('active', idx === index);
    });
    
    const claim = claims[index];
    
    // Header
    document.getElementById('claim-id-display').innerText = `Claim #${index + 1} (${claim.user_id})`;
    document.getElementById('claim-subtitle').innerText = `Multimodal verification workspace for ${claim.claim_object} claim.`;
    document.getElementById('claim-object-badge').innerText = claim.claim_object;
    document.getElementById('claim-object-badge').className = `badge ${claim.claim_object}`;
    
    // Format Chat Transcript
    formatChatTranscript(claim.user_claim);
    
    // Fetch and populate User History
    fetchUserHistory(claim.user_id);
    
    // Evidence Requirements checklist
    populateEvidenceRequirements(claim.claim_object);
    
    // Image board
    loadImages(claim.image_paths);
    
    // Reset verdict output
    hideVerdict();
}

// Formats chat transcript text to beautiful dialog boxes
function formatChatTranscript(transcript) {
    const chatBox = document.getElementById('chat-box');
    chatBox.innerHTML = '';
    
    const turns = transcript.split('|');
    turns.forEach(turn => {
        const turnStr = turn.trim();
        if (!turnStr) return;
        
        let speaker = 'customer';
        let text = turnStr;
        
        if (turnStr.startsWith('Customer:')) {
            speaker = 'customer';
            text = turnStr.substring(9).trim();
        } else if (turnStr.startsWith('Support:')) {
            speaker = 'support';
            text = turnStr.substring(8).trim();
        } else if (turnStr.startsWith('Agent:')) {
            speaker = 'agent';
            text = turnStr.substring(6).trim();
        } else if (turnStr.startsWith('System:')) {
            speaker = 'support';
            text = turnStr.substring(7).trim();
        } else {
            // Check first word
            const colonIdx = turnStr.indexOf(':');
            if (colonIdx !== -1 && colonIdx < 15) {
                const spk = turnStr.substring(0, colonIdx).toLowerCase();
                if (spk.includes('agent') || spk.includes('support')) {
                    speaker = 'support';
                }
                text = turnStr.substring(colonIdx + 1).trim();
            }
        }
        
        const msgDiv = document.createElement('div');
        msgDiv.className = `chat-message ${speaker}`;
        msgDiv.innerHTML = `<strong>${speaker.toUpperCase()}:</strong> ${text}`;
        chatBox.appendChild(msgDiv);
    });
    
    // Scroll to bottom
    chatBox.scrollTop = chatBox.scrollHeight;
}

// Fetch user history from API
async function fetchUserHistory(userId) {
    try {
        const res = await fetch(`/api/history?user_id=${userId}`);
        const data = await res.json();
        
        document.getElementById('hist-past-claims').innerText = data.past_claim_count;
        document.getElementById('hist-accepted').innerText = data.accept_claim;
        document.getElementById('hist-rejected').innerText = data.rejected_claim;
        document.getElementById('hist-90_days').innerText = data.last_90_days_claim_count;
        document.getElementById('hist-summary-text').innerText = data.history_summary;
        
        // Render history risk flags
        const flagsWrapper = document.getElementById('history-flags-wrapper');
        flagsWrapper.innerHTML = '';
        
        if (data.history_flags && data.history_flags !== 'none') {
            data.history_flags.split(';').forEach(flag => {
                const span = document.createElement('span');
                span.className = 'risk-badge';
                span.innerText = flag.replace(/_/g, ' ');
                flagsWrapper.appendChild(span);
            });
        } else {
            const span = document.createElement('span');
            span.className = 'risk-badge none-risk';
            span.innerText = 'Low Risk User';
            flagsWrapper.appendChild(span);
        }
    } catch (err) {
        document.getElementById('hist-summary-text').innerText = `Error loading history: ${err.message}`;
    }
}

// Load evidence requirements checklist
function populateEvidenceRequirements(claimObject) {
    const list = document.getElementById('reqs-list');
    list.innerHTML = '';
    
    // Local rules database
    const generalRules = [
        "The claimed object and relevant part must be clearly visible.",
        "Images must support the visual presence of the reported damage.",
        "Image set must contain relevant orientation to verify claims."
    ];
    
    const specificRules = {
        "car": [
            "Deformation or scratch marks on bumpers or panels must be inspectable.",
            "windshield cracks or headlights cracks must show clear visual patterns.",
            "taillight, side mirror, or body components must fit the claimed vehicle context."
        ],
        "laptop": [
            "Laptop screens, keyboard or trackpads must show clear cracks or liquid stains.",
            "Laptop hinges, ports, lid or corners must be photographed clearly."
        ],
        "package": [
            "Package exterior showing crushed corners, water stains, or torn seals must be visible.",
            "Box contents must be visible if item loss/damage is claimed."
        ]
    };
    
    const rules = [...generalRules, ...(specificRules[claimObject] || [])];
    rules.forEach(rule => {
        const li = document.createElement('li');
        li.innerText = rule;
        list.appendChild(li);
    });
}

// Load and display images
function loadImages(imagePathsStr) {
    const gallery = document.getElementById('image-gallery');
    gallery.innerHTML = '';
    
    if (!imagePathsStr) {
        gallery.innerHTML = `
            <div class="gallery-placeholder">
                <p>No images submitted with this claim.</p>
            </div>`;
        document.getElementById('image-count-badge').innerText = "0 Images";
        return;
    }
    
    const paths = imagePathsStr.split(';').map(p => p.trim()).filter(Boolean);
    document.getElementById('image-count-badge').innerText = `${paths.length} Image${paths.length > 1 ? 's' : ''}`;
    
    paths.forEach(p => {
        // Resolve URL (server will serve it under /dataset/images/...)
        // Replace dataset/ if present in path, since server resolves /dataset/images/...
        let cleanPath = p;
        if (p.startsWith('dataset/')) {
            cleanPath = p.replace('dataset/', '');
        }
        
        const container = document.createElement('div');
        container.className = 'evidence-image-container';
        container.onclick = () => openLightbox(`/dataset/${cleanPath}`);
        
        // image ID
        const imgName = cleanPath.split('/').pop() || cleanPath;
        const stem = imgName.split('.')[0] || imgName;
        
        container.innerHTML = `
            <img src="/dataset/${cleanPath}" alt="Evidence" onerror="this.src='https://placehold.co/150x110/0b0f19/f3f4f6?text=Image+Missing'">
            <span class="image-id-tag">${stem}</span>
        `;
        gallery.appendChild(container);
    });
}

// Lightbox modal controls
function openLightbox(src) {
    const box = document.getElementById('lightbox');
    const img = document.getElementById('lightbox-img');
    img.src = src;
    box.style.display = 'flex';
}

function closeLightbox() {
    document.getElementById('lightbox').style.display = 'none';
}

// Reset results box
function hideVerdict() {
    document.getElementById('results-placeholder').style.display = 'flex';
    document.getElementById('placeholder-text').style.display = 'block';
    document.getElementById('spinner-wrapper').style.display = 'none';
    document.getElementById('verdict-report').style.display = 'none';
}

// Run Claim Verification
async function runVerification() {
    if (selectedIndex === -1) {
        alert("Please select a claim from the sidebar first.");
        return;
    }
    
    // UI state: loading
    document.getElementById('results-placeholder').style.display = 'flex';
    document.getElementById('placeholder-text').style.display = 'none';
    document.getElementById('spinner-wrapper').style.display = 'block';
    document.getElementById('verdict-report').style.display = 'none';
    document.getElementById('btn-verify').disabled = true;
    
    const strategy = document.getElementById('strategy-select').value;
    
    try {
        const response = await fetch('/api/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                dataset: activeDataset,
                index: selectedIndex,
                strategy: strategy
            })
        });
        
        const data = await response.json();
        
        // Populate results
        document.getElementById('results-placeholder').style.display = 'none';
        document.getElementById('verdict-report').style.display = 'flex';
        
        const v = data.verdict;
        
        // Status Badge
        const statusBox = document.getElementById('verdict-claim-status');
        statusBox.innerText = v.claim_status.replace(/_/g, ' ');
        statusBox.className = `status-value ${v.claim_status}`;
        
        // Severity Badge
        const sevBox = document.getElementById('verdict-severity');
        sevBox.innerText = v.severity;
        sevBox.className = `severity-value ${v.severity}`;
        
        // Indicators
        const validImg = document.getElementById('verdict-valid-image');
        validImg.innerText = v.valid_image ? "TRUE" : "FALSE";
        validImg.className = `status-indicator ${v.valid_image}`;
        
        const evidenceMet = document.getElementById('verdict-evidence-met');
        evidenceMet.innerText = v.evidence_standard_met ? "TRUE" : "FALSE";
        evidenceMet.className = `status-indicator ${v.evidence_standard_met}`;
        
        // Confidence
        const confidenceVal = document.getElementById('verdict-confidence');
        if (v.confidence_score !== undefined) {
            confidenceVal.innerText = `${(v.confidence_score * 100).toFixed(0)}%`;
        } else {
            confidenceVal.innerText = '100%';
        }
        
        // Fields
        document.getElementById('verdict-issue-type').innerText = v.issue_type.replace(/_/g, ' ');
        document.getElementById('verdict-object-part').innerText = v.object_part.replace(/_/g, ' ');
        document.getElementById('verdict-supporting-images').innerText = v.supporting_image_ids.replace(/;/g, '; ');
        document.getElementById('verdict-evidence-reason').innerText = v.evidence_standard_met_reason;
        document.getElementById('verdict-justification').innerText = v.claim_status_justification;
        document.getElementById('verdict-scratchpad').innerText = v.reasoning_scratchpad || 'N/A';
        
        // Risk flags badges
        const riskWrapper = document.getElementById('verdict-risk-flags');
        riskWrapper.innerHTML = '';
        if (v.risk_flags && v.risk_flags !== 'none') {
            v.risk_flags.split(';').forEach(flag => {
                const span = document.createElement('span');
                span.className = 'risk-badge';
                span.innerText = flag.replace(/_/g, ' ');
                riskWrapper.appendChild(span);
            });
        } else {
            const span = document.createElement('span');
            span.className = 'risk-badge none-risk';
            span.innerText = 'No Risks Flagged';
            riskWrapper.appendChild(span);
        }
        
        // Token stats
        document.getElementById('tok-input').innerText = data.input_tokens.toLocaleString();
        document.getElementById('tok-output').innerText = data.output_tokens.toLocaleString();
        document.getElementById('tok-cost').innerText = `$${data.estimated_cost_usd.toFixed(4)}`;
        
    } catch (err) {
        document.getElementById('spinner-wrapper').style.display = 'none';
        document.getElementById('placeholder-text').style.display = 'block';
        document.getElementById('placeholder-text').innerHTML = `<span class="danger">Error executing agent: ${err.message}</span>`;
    } finally {
        document.getElementById('btn-verify').disabled = false;
    }
}

// Load metrics dashboard tab
async function loadMetrics() {
    const loading = document.getElementById('metrics-loading');
    const content = document.getElementById('metrics-content');
    
    try {
        const response = await fetch('/api/metrics');
        const metrics = await response.json();
        
        if (metrics.error) {
            loading.innerText = metrics.error;
            loading.style.display = 'block';
            content.style.display = 'none';
            return;
        }
        
        loading.style.display = 'none';
        content.style.display = 'grid';
        
        // Populate Strategy A
        const stra = metrics.strategy_a;
        document.getElementById('stra-acc-circle').innerText = `${(stra.overall_row_accuracy * 100).toFixed(0)}%`;
        document.getElementById('stra-acc-circle').style.background = `radial-gradient(circle, var(--bg-card) 50%, transparent 50%), conic-gradient(var(--accent) ${stra.overall_row_accuracy * 360}deg, var(--border-color) 0deg)`;
        
        document.getElementById('stra-calls').innerText = stra.total_calls;
        document.getElementById('stra-tokens').innerText = (stra.total_input_tokens + stra.total_output_tokens).toLocaleString();
        document.getElementById('stra-cost').innerText = `$${stra.estimated_cost_usd.toFixed(4)}`;
        document.getElementById('stra-latency').innerText = `${stra.latency_per_claim.toFixed(2)}s`;
        
        renderFieldAccuracies('stra-field-accuracies', stra.field_accuracies);
        
        // Populate Strategy B
        const strb = metrics.strategy_b;
        document.getElementById('strb-acc-circle').innerText = `${(strb.overall_row_accuracy * 100).toFixed(0)}%`;
        document.getElementById('strb-acc-circle').style.background = `radial-gradient(circle, var(--bg-card) 50%, transparent 50%), conic-gradient(var(--accent) ${strb.overall_row_accuracy * 360}deg, var(--border-color) 0deg)`;
        
        document.getElementById('strb-calls').innerText = strb.total_calls;
        document.getElementById('strb-tokens').innerText = (strb.total_input_tokens + strb.total_output_tokens).toLocaleString();
        document.getElementById('strb-cost').innerText = `$${strb.estimated_cost_usd.toFixed(4)}`;
        document.getElementById('strb-latency').innerText = `${strb.latency_per_claim.toFixed(2)}s`;
        
        renderFieldAccuracies('strb-field-accuracies', strb.field_accuracies);
        
        // Render Confusion Matrix
        renderConfusionMatrix(stra.claim_status_confusion);
        
        // Render Severity Distribution
        renderSeverityDistribution(stra.severity_distribution);
        
    } catch (err) {
        loading.innerText = `Error fetching metrics: ${err.message}`;
    }
}

// Render field accuracies progress bars
function renderFieldAccuracies(containerId, fieldAccs) {
    const wrapper = document.getElementById(containerId);
    wrapper.innerHTML = '';
    
    // Sort fields by name
    const fields = Object.keys(fieldAccs).sort();
    fields.forEach(field => {
        const val = fieldAccs[field];
        const row = document.createElement('div');
        row.className = 'accuracy-row';
        row.innerHTML = `
            <div class="acc-bar-wrapper">
                <span>${field.replace(/_/g, ' ')}</span>
                <strong>${(val * 100).toFixed(0)}%</strong>
            </div>
            <div class="acc-bar-bg">
                <div class="acc-bar-fill" style="width: ${val * 100}%"></div>
            </div>
        `;
        wrapper.appendChild(row);
    });
}

// Render Confusion Matrix Table
function renderConfusionMatrix(confusion) {
    const wrapper = document.getElementById('matrix-wrapper');
    wrapper.innerHTML = '';
    
    const statuses = ['supported', 'contradicted', 'not_enough_information'];
    const table = document.createElement('table');
    table.className = 'confusion-table';
    
    // Header
    table.innerHTML = `
        <tr>
            <th rowspan="2" colspan="2" style="border:none; background:none;"></th>
            <th colspan="3">PREDICTED</th>
        </tr>
        <tr>
            <th>Supported</th>
            <th>Contradicted</th>
            <th>Not Enough Info</th>
        </tr>
    `;
    
    // Rows
    statuses.forEach((exp, rowIdx) => {
        const tr = document.createElement('tr');
        if (rowIdx === 0) {
            tr.innerHTML = `<th rowspan="3" style="writing-mode: vertical-lr; transform: rotate(180deg); padding: 4px;">EXPECTED</th>`;
        }
        
        tr.innerHTML += `<th>${exp.replace(/_/g, ' ').toUpperCase()}</th>`;
        
        statuses.forEach(pred => {
            const expKey = `expected_${exp}`;
            const predKey = `predicted_${pred}`;
            const count = confusion[expKey] ? confusion[expKey][predKey] || 0 : 0;
            
            const isCorrect = (exp === pred);
            const cellClass = isCorrect ? 'correct-cell' : (count > 0 ? 'incorrect-cell' : '');
            
            tr.innerHTML += `<td class="cell-value ${cellClass}">${count}</td>`;
        });
        table.appendChild(tr);
    });
    
    wrapper.appendChild(table);
}

// Render Severity Distribution Bars Comparison
function renderSeverityDistribution(severityDist) {
    const wrapper = document.getElementById('severity-wrapper');
    wrapper.innerHTML = '';
    
    const categories = ['none', 'low', 'medium', 'high', 'unknown'];
    
    // Find max value for scaling bar width
    let maxVal = 1;
    categories.forEach(cat => {
        const expVal = severityDist.expected[cat] || 0;
        const predVal = severityDist.predicted[cat] || 0;
        if (expVal > maxVal) maxVal = expVal;
        if (predVal > maxVal) maxVal = predVal;
    });
    
    categories.forEach(cat => {
        const exp = severityDist.expected[cat] || 0;
        const pred = severityDist.predicted[cat] || 0;
        
        const row = document.createElement('div');
        row.className = 'dist-row';
        row.innerHTML = `
            <div class="dist-bar-header">
                <strong>${cat}</strong>
                <span>Expected: ${exp} | Pred: ${pred}</span>
            </div>
            <div class="dist-bars">
                <div style="display:flex; align-items:center; gap:8px;">
                    <span class="bar-lbl" style="width:30px;">EXP</span>
                    <div class="bar-bg">
                        <div class="bar-fill-exp" style="width: ${(exp / maxVal) * 100}%"></div>
                    </div>
                </div>
                <div style="display:flex; align-items:center; gap:8px;">
                    <span class="bar-lbl" style="width:30px;">PRED</span>
                    <div class="bar-bg">
                        <div class="bar-fill-pred" style="width: ${(pred / maxVal) * 100}%"></div>
                    </div>
                </div>
            </div>
        `;
        wrapper.appendChild(row);
    });
}
