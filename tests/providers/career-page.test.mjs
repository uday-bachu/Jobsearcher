import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider - career-page');

try {
  const { isDirectPosting } = await import(pathToFileURL(join(ROOT, 'providers/career-page.mjs')).href);
  const listingUrl = 'https://in.indeed.com/jobs?q=.NET+Developer&l=India';

  if (isDirectPosting({ title: '.NET Developer', url: 'https://in.indeed.com/rc/clk?jk=123' }, listingUrl)) {
    pass('keeps an Indeed click-through posting');
  } else {
    fail('discarded an Indeed click-through posting');
  }

  if (isDirectPosting({ title: 'Staff Backend Engineer', url: 'https://wellfound.com/jobs/4728532-staff-backend-engineer' }, 'https://wellfound.com/jobs')) {
    pass('keeps a Wellfound job URL');
  } else {
    fail('discarded a Wellfound job URL');
  }

  if (!isDirectPosting({ title: '.NET Developer jobs in Remote', url: listingUrl }, listingUrl)) {
    pass('drops an Indeed search page');
  } else {
    fail('kept an Indeed search page');
  }

  if (!isDirectPosting({ title: '.NET Developer salaries in Chennai', url: 'https://in.indeed.com/career/.net-developer/salaries/Chennai' }, listingUrl)) {
    pass('drops an Indeed salary page');
  } else {
    fail('kept an Indeed salary page');
  }
} catch (error) {
  fail(`career-page provider tests could not run: ${error.message}`);
}