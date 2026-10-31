import open from 'open';
import { splitRepoDoc } from './utils.js';
import {
  getUser,
  listRepos as apiListRepos,
  listDocs as apiListDocs,
  searchDocs as apiSearchDocs,
  getDoc,
  getRepo as apiGetRepo,
  createDoc as apiCreateDoc,
  updateDoc as apiUpdateDoc,
  deleteDoc as apiDeleteDoc,
  apiRequest as apiRawRequest
} from './api.js';

export function createCommands(deps = {}) {
  const {
    getUserFn = getUser,
    listReposFn = apiListRepos,
    listDocsFn = apiListDocs,
    searchDocsFn = apiSearchDocs,
    getDocFn = getDoc,
    getRepoFn = apiGetRepo,
    createDocFn = apiCreateDoc,
    updateDocFn = apiUpdateDoc,
    deleteDocFn = apiDeleteDoc,
    apiRequestFn = apiRawRequest,
    splitRepoDocFn = splitRepoDoc,
    openUrlFn = open
  } = deps;

  async function whoami(options) {
    return await getUserFn(options);
  }

  async function listRepos(options) {
    return await listReposFn(options);
  }

  async function listDocs(repo, options) {
    return await listDocsFn(repo, options);
  }

  async function searchDocs(repo, q, options) {
    return await searchDocsFn(repo, q, options);
  }

  async function openDoc(input, fallbackRepo = null, options = {}) {
    const parsed = splitRepoDocFn(input);
    const repo = parsed?.repo || fallbackRepo;
    const slug = parsed?.doc || input;
    if (!repo || !slug) {
      throw new Error('Use <repo>/<doc> format or set current repo');
    }
    const doc = await getDocFn(repo, slug, options);
    const finalUrl = doc?.url || `https://www.yuque.com/${repo}/${slug}`;
    await openUrlFn(finalUrl);
    return { ...(doc || {}), url: finalUrl };
  }

  async function readDoc(repo, slug, options) {
    return await getDocFn(repo, slug, options);
  }

  async function readRepo(repo, options) {
    return await getRepoFn(repo, options);
  }

  async function createDoc(repo, payload, options) {
    return await createDocFn(repo, payload, options);
  }

  async function updateDoc(repo, slug, payload, options) {
    return await updateDocFn(repo, slug, payload, options);
  }

  async function deleteDoc(repo, slug, options) {
    return await deleteDocFn(repo, slug, options);
  }

  async function apiRequest(method, path, options) {
    return await apiRequestFn(method, path, options);
  }

  return {
    whoami,
    listRepos,
    listDocs,
    searchDocs,
    openDoc,
    readDoc,
    readRepo,
    createDoc,
    updateDoc,
    deleteDoc,
    apiRequest
  };
}

const defaultCommands = createCommands();

export const {
  whoami,
  listRepos,
  listDocs,
  searchDocs,
  openDoc,
  readDoc,
  readRepo,
  createDoc,
  updateDoc,
  deleteDoc,
  apiRequest
} = defaultCommands;
