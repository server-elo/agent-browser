/**
 * Skills System — Pre-built automation workflows
 *
 * Each skill is a reusable sequence of browser actions that the LLM can invoke.
 * Skills can also be loaded from external .json files in the skills/ directory.
 *
 * @author Lorenc
 */

export interface Skill {
  name: string;
  description: string;
  category: string;
  steps: string; // Natural language instructions for the LLM
}

export const skills: Skill[] = [

  // ============================================================================
  // LINKEDIN (10 skills)
  // ============================================================================

  {
    name: "linkedin_connect",
    description: "Send connection requests on LinkedIn",
    category: "linkedin",
    steps: `1. Navigate to https://www.linkedin.com/mynetwork/grow/
2. Wait for page to load
3. Enable stealth mode first
4. Find all buttons with text "Connect" using find_by_text
5. For each Connect button found:
   a. Click it using click_text with tag "button"
   b. Wait 1000ms
   c. If a dialog appears with "Send without a note", click "Send without a note" or "Send"
   d. Wait 500ms
6. After clicking all visible ones, scroll down 600px
7. Wait 1500ms for new suggestions to load
8. Repeat from step 4 until target count is reached
9. Report how many connections were sent`
  },

  {
    name: "linkedin_message",
    description: "Send a message to a LinkedIn connection",
    category: "linkedin",
    steps: `1. Navigate to the person's LinkedIn profile URL
2. Click the "Message" button using click_text
3. Wait 1000ms for the message window to open
4. Type the message using type_text in the message input
5. Click "Send" button
6. Confirm message was sent`
  },

  {
    name: "linkedin_search_people",
    description: "Search for people on LinkedIn by keywords",
    category: "linkedin",
    steps: `1. Navigate to https://www.linkedin.com/search/results/people/
2. Find the search input and type the search query
3. Press Enter
4. Wait for results to load
5. Use get_page_text to read the results
6. Report the names, titles, and profile URLs found`
  },

  {
    name: "linkedin_endorse",
    description: "Endorse skills on a LinkedIn profile",
    category: "linkedin",
    steps: `1. Navigate to the person's LinkedIn profile
2. Scroll down to the Skills section using scroll_to_element or find_by_text "Skills"
3. Find endorse/+ buttons near each skill
4. Click each endorse button
5. Report which skills were endorsed`
  },

  {
    name: "linkedin_follow_company",
    description: "Follow a company on LinkedIn",
    category: "linkedin",
    steps: `1. Navigate to the company's LinkedIn page
2. Find the "Follow" button using find_by_text or find_by_role
3. Click it
4. Confirm the follow was successful (button changes to "Following")`
  },

  {
    name: "linkedin_like_posts",
    description: "Like posts in LinkedIn feed",
    category: "linkedin",
    steps: `1. Navigate to https://www.linkedin.com/feed/
2. Wait for feed to load
3. Find Like buttons using find_by_aria with aria-label containing "Like"
4. Click each Like button
5. Scroll down to reveal more posts
6. Repeat until target count is reached
7. Report how many posts were liked`
  },

  {
    name: "linkedin_save_job",
    description: "Search and save jobs on LinkedIn",
    category: "linkedin",
    steps: `1. Navigate to https://www.linkedin.com/jobs/
2. Type the job title in the search box
3. Type the location
4. Press Enter
5. Wait for results
6. For each job listing, click "Save" or the bookmark icon
7. Report saved jobs`
  },

  {
    name: "linkedin_accept_invitations",
    description: "Accept all pending LinkedIn connection invitations",
    category: "linkedin",
    steps: `1. Navigate to https://www.linkedin.com/mynetwork/invitation-manager/
2. Wait for invitations to load
3. Find all "Accept" buttons using find_by_text
4. Click each Accept button with a 500ms delay between
5. If more invitations, scroll down and repeat
6. Report how many were accepted`
  },

  {
    name: "linkedin_extract_profile",
    description: "Extract profile information from a LinkedIn profile",
    category: "linkedin",
    steps: `1. Navigate to the LinkedIn profile URL
2. Wait for page to load
3. Use get_page_text to read all visible text
4. Extract: name, headline, location, about section, experience, education, skills
5. Return structured data`
  },

  {
    name: "linkedin_post",
    description: "Create a new LinkedIn post",
    category: "linkedin",
    steps: `1. Navigate to https://www.linkedin.com/feed/
2. Click "Start a post" button
3. Wait for the post editor to open
4. Type the post content
5. Click "Post" button
6. Confirm post was published`
  },

  // ============================================================================
  // WEB SCRAPING (10 skills)
  // ============================================================================

  {
    name: "scrape_emails",
    description: "Extract email addresses from a webpage",
    category: "scraping",
    steps: `1. Navigate to the target URL
2. Use evaluate_js to extract emails: document.body.innerText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}/g)
3. Also check mailto: links
4. Scroll down to load more content
5. Repeat extraction
6. Return unique email list`
  },

  {
    name: "scrape_links",
    description: "Extract all links from a webpage",
    category: "scraping",
    steps: `1. Navigate to the target URL
2. Use evaluate_js: Array.from(document.querySelectorAll('a[href]')).map(a => ({text: a.textContent.trim(), url: a.href}))
3. Filter out navigation/footer links if needed
4. Return the list of links with their text`
  },

  {
    name: "scrape_images",
    description: "Extract all image URLs from a webpage",
    category: "scraping",
    steps: `1. Navigate to the target URL
2. Use evaluate_js: Array.from(document.querySelectorAll('img')).map(img => ({src: img.src, alt: img.alt, width: img.naturalWidth, height: img.naturalHeight}))
3. Filter out tiny/icon images (less than 100px)
4. Return image URLs with their dimensions`
  },

  {
    name: "scrape_table",
    description: "Extract data from an HTML table",
    category: "scraping",
    steps: `1. Navigate to the target URL
2. Find the table using get_elements with filter "table"
3. Use evaluate_js to extract: Array.from(document.querySelectorAll('table tr')).map(tr => Array.from(tr.querySelectorAll('td,th')).map(td => td.textContent.trim()))
4. Return as structured rows`
  },

  {
    name: "scrape_prices",
    description: "Extract product prices from an e-commerce page",
    category: "scraping",
    steps: `1. Navigate to the target URL
2. Use evaluate_js to find price elements: document.body.innerText.match(/[$€£]\\s?[\\d,.]+/g)
3. Also check elements with class/attr containing "price"
4. Scroll down to load more products
5. Return prices with associated product names`
  },

  {
    name: "scrape_articles",
    description: "Extract article content (title, text, date, author)",
    category: "scraping",
    steps: `1. Navigate to the article URL
2. Use evaluate_js to extract:
   - Title: document.querySelector('h1')?.textContent
   - Author: look for elements with "author" in class/attr
   - Date: look for time elements or date patterns
   - Content: main article text
3. Return structured article data`
  },

  {
    name: "scrape_reviews",
    description: "Extract reviews from a product page",
    category: "scraping",
    steps: `1. Navigate to the product page URL
2. Scroll to reviews section
3. Extract each review: rating, author, date, text
4. Click "next page" or "load more" if available
5. Repeat until all reviews collected
6. Return structured review data`
  },

  {
    name: "scrape_social_profiles",
    description: "Find social media profile links on a webpage",
    category: "scraping",
    steps: `1. Navigate to the target URL
2. Use evaluate_js: Array.from(document.querySelectorAll('a[href]')).filter(a => /twitter|x\\.com|facebook|instagram|linkedin|youtube|tiktok|github/.test(a.href)).map(a => a.href)
3. Return unique social media URLs`
  },

  {
    name: "scrape_sitemap",
    description: "Discover all pages on a website",
    category: "scraping",
    steps: `1. Try to fetch /sitemap.xml first
2. If not found, navigate to the homepage
3. Extract all internal links
4. Follow links to discover more pages (breadth-first, max 2 levels)
5. Return list of all discovered URLs`
  },

  {
    name: "scrape_contact_info",
    description: "Find contact information on a website",
    category: "scraping",
    steps: `1. Navigate to the target URL
2. Look for "Contact" or "About" links and click them
3. Extract: emails, phone numbers, addresses, social links
4. Phone regex: text.match(/[+]?[\\d\\s.-]{7,15}/g)
5. Return all contact info found`
  },

  // ============================================================================
  // FORM AUTOMATION (8 skills)
  // ============================================================================

  {
    name: "fill_login_form",
    description: "Log into a website with username and password",
    category: "forms",
    steps: `1. Navigate to the login URL
2. Find username/email input using find_by_aria or get_form_fields
3. Type the username
4. Find password input
5. Type the password
6. Click the login/submit button
7. Wait for redirect
8. Confirm login was successful`
  },

  {
    name: "fill_registration",
    description: "Fill out a registration/signup form",
    category: "forms",
    steps: `1. Navigate to the registration URL
2. Use get_form_fields to identify all fields
3. Fill each field using fill_form with the provided data
4. Handle select dropdowns with select_option
5. Check any required checkboxes (terms, etc)
6. Click the submit/register button
7. Handle any captcha or verification if needed`
  },

  {
    name: "fill_checkout",
    description: "Fill out an e-commerce checkout form",
    category: "forms",
    steps: `1. Get all form fields using get_form_fields
2. Fill shipping info: name, address, city, state, zip, country
3. Fill payment info: card number, expiry, CVV
4. Select shipping method if available
5. Review order summary
6. Click place order button`
  },

  {
    name: "fill_application",
    description: "Fill out a job application form",
    category: "forms",
    steps: `1. Navigate to the application URL
2. Use get_form_fields to identify all fields
3. Fill personal info: name, email, phone
4. Fill experience fields
5. Upload resume if there's a file input using upload_file
6. Fill any additional fields
7. Submit the application`
  },

  {
    name: "fill_survey",
    description: "Complete an online survey",
    category: "forms",
    steps: `1. Navigate to the survey URL
2. For each page/question:
   a. Read the question using get_page_text
   b. Select radio buttons, checkboxes, or type text answers
   c. Click Next/Continue
3. Submit the survey when complete`
  },

  {
    name: "subscribe_newsletter",
    description: "Subscribe to a newsletter on a website",
    category: "forms",
    steps: `1. Navigate to the website
2. Look for newsletter signup (usually in footer or popup)
3. Find email input using find_by_aria with placeholder "email"
4. Type the email address
5. Click Subscribe/Sign Up button
6. Handle any confirmation dialog`
  },

  {
    name: "submit_feedback",
    description: "Submit a feedback or contact form",
    category: "forms",
    steps: `1. Navigate to the contact/feedback page
2. Fill in name, email, subject, message fields
3. Select category if available
4. Click Submit
5. Confirm submission was successful`
  },

  {
    name: "book_appointment",
    description: "Book an appointment through an online form",
    category: "forms",
    steps: `1. Navigate to the booking page
2. Select date from calendar
3. Select available time slot
4. Fill personal information
5. Select service type if needed
6. Confirm booking
7. Take screenshot of confirmation`
  },

  // ============================================================================
  // TESTING (8 skills)
  // ============================================================================

  {
    name: "test_responsive",
    description: "Test a website at different screen sizes",
    category: "testing",
    steps: `1. Navigate to the target URL
2. Test at these viewports:
   - Mobile: set_viewport 375 812 (iPhone)
   - Tablet: set_viewport 768 1024 (iPad)
   - Desktop: set_viewport 1920 1080
3. Take a screenshot at each size
4. Check for overflow or broken layout using evaluate_js
5. Report any issues found`
  },

  {
    name: "test_links",
    description: "Check all links on a page for broken URLs",
    category: "testing",
    steps: `1. Navigate to the target URL
2. Extract all links using evaluate_js
3. For each link:
   a. Open in new tab
   b. Check if page loads (no errorText)
   c. Close tab
4. Report broken links`
  },

  {
    name: "test_forms",
    description: "Test form validation on a webpage",
    category: "testing",
    steps: `1. Navigate to the page with forms
2. Try submitting empty form — check for validation errors
3. Fill with invalid data (bad email, short password) — check errors
4. Fill with valid data — check success
5. Report validation behavior`
  },

  {
    name: "test_accessibility",
    description: "Run accessibility checks on a webpage",
    category: "testing",
    steps: `1. Navigate to the target URL
2. Get the accessibility tree using get_accessibility_tree
3. Check for:
   - Images without alt text
   - Form inputs without labels
   - Low contrast (use evaluate_js)
   - Missing heading hierarchy
   - Interactive elements without accessible names
4. Report accessibility issues`
  },

  {
    name: "test_performance",
    description: "Check page load performance",
    category: "testing",
    steps: `1. Navigate to the target URL
2. Use evaluate_js: JSON.stringify(performance.timing)
3. Calculate: DNS time, connect time, TTFB, page load time
4. Check number of requests and total size
5. Report performance metrics`
  },

  {
    name: "test_seo",
    description: "Check basic SEO of a webpage",
    category: "testing",
    steps: `1. Navigate to the target URL
2. Check for:
   - Title tag (length 50-60 chars)
   - Meta description (length 150-160 chars)
   - H1 tag (exactly one)
   - Images with alt text
   - Canonical URL
   - Open Graph tags
   - robots.txt and sitemap.xml
3. Report SEO score and issues`
  },

  {
    name: "test_dark_mode",
    description: "Test dark mode appearance",
    category: "testing",
    steps: `1. Navigate to the target URL
2. Take screenshot in light mode
3. Enable dark mode using set_dark_mode
4. Take screenshot in dark mode
5. Compare and report differences`
  },

  {
    name: "test_mobile",
    description: "Test mobile version of a website",
    category: "testing",
    steps: `1. Set viewport to mobile: set_viewport 375 812 with mobile=true and device_scale=3
2. Enable touch emulation
3. Navigate to the target URL
4. Check for mobile-friendly layout
5. Test tap interactions
6. Take screenshots
7. Report mobile compatibility`
  },

  // ============================================================================
  // SOCIAL MEDIA (6 skills)
  // ============================================================================

  {
    name: "twitter_post",
    description: "Post a tweet on X/Twitter",
    category: "social",
    steps: `1. Navigate to https://x.com/compose/tweet
2. Wait for the tweet editor
3. Type the tweet text
4. Click the Tweet/Post button
5. Confirm it was posted`
  },

  {
    name: "twitter_like_tweets",
    description: "Like tweets in your Twitter feed",
    category: "social",
    steps: `1. Navigate to https://x.com/home
2. Find Like buttons (heart icons) using find_by_aria
3. Click each like button
4. Scroll down for more tweets
5. Repeat until target count`
  },

  {
    name: "instagram_like_posts",
    description: "Like posts on Instagram",
    category: "social",
    steps: `1. Navigate to https://www.instagram.com/
2. Find heart/like buttons
3. Double-click on images to like them
4. Scroll down for more posts
5. Repeat until target count`
  },

  {
    name: "github_star_repos",
    description: "Star repositories on GitHub",
    category: "social",
    steps: `1. Navigate to the GitHub profile or search results
2. Find "Star" buttons using find_by_text
3. Click each Star button
4. Report which repos were starred`
  },

  {
    name: "youtube_subscribe",
    description: "Subscribe to a YouTube channel",
    category: "social",
    steps: `1. Navigate to the YouTube channel URL
2. Find the "Subscribe" button
3. Click it
4. Handle any confirmation dialog
5. Confirm subscription`
  },

  {
    name: "reddit_upvote",
    description: "Upvote posts on Reddit",
    category: "social",
    steps: `1. Navigate to the Reddit page
2. Find upvote buttons using find_by_aria
3. Click each upvote
4. Scroll for more posts
5. Repeat until target count`
  },

  // ============================================================================
  // DATA EXTRACTION (4 skills)
  // ============================================================================

  {
    name: "extract_to_csv",
    description: "Extract structured data and format as CSV",
    category: "data",
    steps: `1. Navigate to the page with data
2. Identify the data structure (table, list, cards)
3. Extract all data using evaluate_js
4. Format as CSV with headers
5. Report the CSV data`
  },

  {
    name: "compare_prices",
    description: "Compare product prices across multiple sites",
    category: "data",
    steps: `1. For each shopping site URL provided:
   a. Navigate to the site
   b. Search for the product
   c. Extract the price
2. Compare all prices
3. Report cheapest option with URL`
  },

  {
    name: "monitor_page_changes",
    description: "Capture the current state of a page for comparison",
    category: "data",
    steps: `1. Navigate to the target URL
2. Take a full screenshot
3. Extract all text content
4. Extract key data points
5. Report the current state`
  },

  {
    name: "extract_structured_data",
    description: "Extract JSON-LD, OpenGraph, and schema.org data from a page",
    category: "data",
    steps: `1. Navigate to the target URL
2. Use evaluate_js to extract:
   - JSON-LD: Array.from(document.querySelectorAll('script[type="application/ld+json"]')).map(s => JSON.parse(s.textContent))
   - OpenGraph: Array.from(document.querySelectorAll('meta[property^="og:"]')).map(m => ({property: m.getAttribute('property'), content: m.content}))
   - Twitter cards: Array.from(document.querySelectorAll('meta[name^="twitter:"]')).map(m => ({name: m.name, content: m.content}))
3. Return all structured data`
  },

  // ============================================================================
  // UTILITY (4 skills)
  // ============================================================================

  {
    name: "screenshot_full_page",
    description: "Take a full-page scrolling screenshot",
    category: "utility",
    steps: `1. Navigate to the target URL
2. Get page height: evaluate_js document.documentElement.scrollHeight
3. Set viewport height to full page height using set_viewport
4. Take screenshot
5. Reset viewport to normal size`
  },

  {
    name: "save_page_pdf",
    description: "Save a webpage as a clean PDF",
    category: "utility",
    steps: `1. Navigate to the target URL
2. Remove ads and popups using remove_element
3. Use save_pdf to generate the PDF
4. Report the saved path`
  },

  {
    name: "clear_browsing_data",
    description: "Clear all cookies, storage, and cache",
    category: "utility",
    steps: `1. Clear all cookies using cdp_clear_cookies
2. Clear localStorage and sessionStorage
3. Report what was cleared`
  },

  {
    name: "setup_stealth",
    description: "Configure browser for undetectable automation",
    category: "utility",
    steps: `1. Enable stealth mode (hide webdriver flag)
2. Set realistic viewport: set_viewport 1920 1080
3. Set natural user agent via add_preload_script
4. Block known bot detection scripts using block_urls
5. Grant all permissions
6. Auto-dismiss dialogs
7. Report stealth configuration`
  },
];

export function getSkillList(): string {
  const categories = new Map<string, Skill[]>();
  for (const s of skills) {
    if (!categories.has(s.category)) categories.set(s.category, []);
    categories.get(s.category)!.push(s);
  }

  let text = "Available skills:\n";
  for (const [cat, items] of categories) {
    text += `\n  ${cat.toUpperCase()}:\n`;
    for (const s of items) {
      text += `    ${s.name} — ${s.description}\n`;
    }
  }
  return text;
}

export function findSkill(name: string): Skill | undefined {
  return skills.find(s => s.name === name || s.name.replace(/_/g, " ") === name.toLowerCase());
}
