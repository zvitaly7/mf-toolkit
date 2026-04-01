import axios from 'axios';

export async function fetchOrders() {
  return axios.get('/orders');
}

export async function fetchOrder(id: string) {
  return axios.get(`/orders/${id}`);
}
